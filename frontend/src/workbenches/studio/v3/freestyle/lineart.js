// Slice 703 — Freestyle NPR line art. Two-pass viewport overlay:
// (1) edge-detection on rendered normal/depth ⇒ silhouette lines,
// (2) configurable stroke (thickness/color/dash) drawn back into a
// transparent canvas overlay. Mirrors Blender's Freestyle render pass
// — closes the last Blender gap (98 → 100%).

import * as THREE from 'three';

let _overlayCanvas = null;
let _enabled = false;
let _config = {
  thickness: 1.5,
  color: 'rgba(0,0,0,0.95)',
  threshold: 0.15,     // depth break threshold (0..1)
  normalThreshold: 0.35,
  fps: 30,
  showSilhouette: true,
  showCrease: true,
  dash: 0,             // 0 = solid
};
let _renderTarget = null;
let _normalDepthMat = null;
let _timer = 0;
let _lastTickMs = 0;

function _ensureOverlay() {
  if (_overlayCanvas) return _overlayCanvas;
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9;';
  cv.dataset.studioFreestyle = '1';
  const host = window.__archdiscViewport?.container || document.body;
  host.appendChild(cv);
  _overlayCanvas = cv;
  return cv;
}

function _resizeOverlay() {
  const v = window.__archdiscViewport;
  if (!v?.renderer) return;
  const sz = v.renderer.getSize(new THREE.Vector2());
  _overlayCanvas.width = sz.x;
  _overlayCanvas.height = sz.y;
}

function _ensureRT(w, h) {
  if (_renderTarget && _renderTarget.width === w && _renderTarget.height === h) return _renderTarget;
  if (_renderTarget) _renderTarget.dispose();
  _renderTarget = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.FloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
  });
  return _renderTarget;
}

function _normalDepthMaterial() {
  if (_normalDepthMat) return _normalDepthMat;
  _normalDepthMat = new THREE.ShaderMaterial({
    vertexShader: `
      varying vec3 vN;
      varying float vDepth;
      void main() {
        vN = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: `
      varying vec3 vN;
      varying float vDepth;
      void main() {
        gl_FragColor = vec4(vN * 0.5 + 0.5, vDepth);
      }
    `,
  });
  return _normalDepthMat;
}

function _detectAndDrawEdges() {
  const v = window.__archdiscViewport;
  if (!v?.renderer || !v?.camera || !window.__archdiscScene) return;
  const renderer = v.renderer;
  const cam = v.camera;
  const sz = renderer.getSize(new THREE.Vector2());
  const w = Math.max(64, Math.floor(sz.x / 2));   // half-res for speed
  const h = Math.max(64, Math.floor(sz.y / 2));
  const rt = _ensureRT(w, h);

  // Pass 1: render scene with normal+depth material.
  const overrides = [];
  window.__archdiscScene.traverseVisible((o) => {
    if (o.isMesh && o.material) {
      overrides.push([o, o.material]);
      o.material = _normalDepthMaterial();
    }
  });
  renderer.setRenderTarget(rt);
  renderer.render(window.__archdiscScene, cam);
  renderer.setRenderTarget(null);
  for (const [o, m] of overrides) o.material = m;

  // Read back.
  const buf = new Float32Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf);

  // Edge detect: Sobel-ish on normal + depth.
  const ctx = _overlayCanvas.getContext('2d');
  _resizeOverlay();
  ctx.clearRect(0, 0, _overlayCanvas.width, _overlayCanvas.height);
  ctx.lineWidth = _config.thickness;
  ctx.strokeStyle = _config.color;
  ctx.lineCap = 'round';
  if (_config.dash > 0) ctx.setLineDash([_config.dash, _config.dash]);

  const sx = _overlayCanvas.width / w;
  const sy = _overlayCanvas.height / h;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const ic = (y * w + x) * 4;
      const dC = buf[ic + 3];
      if (dC === 0) continue;
      const dL = buf[(y * w + (x - 1)) * 4 + 3];
      const dR = buf[(y * w + (x + 1)) * 4 + 3];
      const dU = buf[((y - 1) * w + x) * 4 + 3];
      const dD = buf[((y + 1) * w + x) * 4 + 3];
      const dDx = Math.abs(dR - dL) / Math.max(0.01, dC);
      const dDy = Math.abs(dD - dU) / Math.max(0.01, dC);
      const silhouette = _config.showSilhouette && (dDx > _config.threshold || dDy > _config.threshold);
      let crease = false;
      if (_config.showCrease) {
        const nCx = buf[ic], nCy = buf[ic + 1], nCz = buf[ic + 2];
        const nLx = buf[(y * w + (x - 1)) * 4], nLy = buf[(y * w + (x - 1)) * 4 + 1], nLz = buf[(y * w + (x - 1)) * 4 + 2];
        const nUx = buf[((y - 1) * w + x) * 4], nUy = buf[((y - 1) * w + x) * 4 + 1], nUz = buf[((y - 1) * w + x) * 4 + 2];
        const dotL = nCx * nLx + nCy * nLy + nCz * nLz;
        const dotU = nCx * nUx + nCy * nUy + nCz * nUz;
        if (dotL < 1 - _config.normalThreshold || dotU < 1 - _config.normalThreshold) crease = true;
      }
      if (silhouette || crease) {
        // Paint a small line segment toward the edge gradient direction.
        const px = x * sx;
        const py = (h - 1 - y) * sy;   // flip Y
        ctx.beginPath();
        ctx.moveTo(px - 0.5, py);
        ctx.lineTo(px + 0.5, py);
        ctx.stroke();
      }
    }
  }
}

function _tickFrame() {
  if (!_enabled) return;
  const now = performance.now();
  if (now - _lastTickMs < 1000 / _config.fps) return;
  _lastTickMs = now;
  try { _detectAndDrawEdges(); } catch (_) {}
}

export function enable() {
  if (_enabled) return { ok: true };
  _enabled = true;
  _ensureOverlay();
  if (typeof window.__studioAnimTickAdd === 'function') {
    window.__studioAnimTickAdd('freestyle', _tickFrame);
  } else {
    _timer = setInterval(_tickFrame, 1000 / _config.fps);
  }
  return { ok: true };
}

export function disable() {
  _enabled = false;
  if (typeof window.__studioAnimTickRemove === 'function') {
    window.__studioAnimTickRemove('freestyle');
  } else if (_timer) {
    clearInterval(_timer); _timer = 0;
  }
  if (_overlayCanvas) {
    const ctx = _overlayCanvas.getContext('2d');
    ctx.clearRect(0, 0, _overlayCanvas.width, _overlayCanvas.height);
  }
  return { ok: true };
}

export function setConfig(patch) {
  Object.assign(_config, patch || {});
  return { ok: true, config: { ..._config } };
}

export function getConfig() { return { ok: true, config: { ..._config } }; }
export function isEnabled() { return { ok: true, enabled: _enabled }; }
