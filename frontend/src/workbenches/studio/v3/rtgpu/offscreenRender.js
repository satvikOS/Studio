// Headless GPU path-traced HERO FRAME — clean, chrome-free, scale-correct.
//
// Why this exists: the live RTGPU preview never accumulates in a script
// context because its per-frame tick (vp.__studioAnimTick) is installed
// but never invoked by the r3f loop, so the overlay stays blank. And a
// window screenshot drags in the editor chrome + the drei grid + frames
// the scene tiny (Studio prims are CAD-micro-scale, scattered in ~0.2 m).
//
// This renders the live scene's REAL meshes (collectTraceableMeshes
// already drops grid / gizmo / ground / helpers) into the existing RTGPU
// renderer (renderer.js), MANUALLY stepping runFrame() to a sample
// target (no tick dependency), with a camera FRAMED on the part bounding
// box (scale-independent — the part fills the frame at any absolute
// size). The accumulated display buffer is flipped + written to a 2D
// canvas → PNG dataUrl. No editor UI is ever in the result.
//
// Mirrors Forge's PathTracedRender.jsx pattern (which is proven) using
// Studio's native renderer instead of three-gpu-pathtracer.

import * as THREE from 'three';
import { createRenderer, probeSupport } from './renderer.js';

function _liveScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}

// Bounding box of the real built primitives only (so the floor/grid/
// gizmo can't pull the framing wide).
function _partBox(scene) {
  const box = new THREE.Box3();
  let any = false;
  scene.traverse((o) => {
    if (o && o.isMesh && o.userData && o.userData.archdiscStudioPrimitive && o.geometry) {
      o.updateWorldMatrix?.(true, false);
      box.expandByObject(o);
      any = true;
    }
  });
  if (!any) { box.setFromObject(scene); }
  return box;
}

function _frameCamera(box, aspect) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() / 2, 1e-3);
  const cam = new THREE.PerspectiveCamera(40, aspect, radius * 0.01, radius * 200);
  // 3/4 hero angle; distance ~2.6×radius so a 40° FOV frames the part
  // filling most of the view (scale to viewer).
  cam.position.set(
    center.x + radius * 1.6,
    center.y + radius * 1.25,
    center.z + radius * 1.9,
  );
  cam.up.set(0, 1, 0);
  cam.lookAt(center);
  cam.updateMatrixWorld(true);
  cam.updateProjectionMatrix();
  return cam;
}

// Flip-Y the bottom-up RGBA trace buffer into a 2D canvas and return a
// PNG dataUrl. `bg` paints behind any transparent pixels so the hero
// frame is never see-through.
function _bufToDataUrl(buf, w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  // Cinematic backdrop — a soft vertical studio gradient behind any
  // transparent pixels (instead of flat grey) reads as a seamless cyc.
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#d7dbe2'); grad.addColorStop(0.55, '#aeb4bd'); grad.addColorStop(1, '#7f858f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const flipped = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * w * 4;
    flipped.set(buf.subarray(src, src + w * 4), y * w * 4);
  }
  // Composite the trace over the bg via a temp canvas (putImageData
  // ignores existing pixels, so we drawImage to blend alpha).
  const tmp = document.createElement('canvas');
  tmp.width = w; tmp.height = h;
  tmp.getContext('2d').putImageData(new ImageData(flipped, w, h), 0, 0);
  ctx.drawImage(tmp, 0, 0);
  // Grade pass — gentle S-curve contrast + radial vignette for a crafted
  // hero look (matches Forge). No re-tonemap (the tracer already tonemaps).
  try {
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    const cx = w / 2, cy = h / 2, maxd = Math.hypot(cx, cy), contrast = 1.08;
    for (let i = 0; i < d.length; i += 4) {
      const idx = i >> 2; const vig = 1 - 0.26 * Math.pow(Math.hypot((idx % w) - cx, ((idx / w) | 0) - cy) / maxd, 2.2);
      for (let c = 0; c < 3; c++) { let v = d[i + c] / 255; v = (v - 0.5) * contrast + 0.5; v *= vig; d[i + c] = Math.max(0, Math.min(255, v * 255)); }
    }
    ctx.putImageData(img, 0, 0);
  } catch (_) { /* grading optional */ }
  return canvas.toDataURL('image/png');
}

export async function runPathTracedOffscreenRender(opts = {}) {
  const {
    width = 1280, height = 720,
    maxSamples = 180, maxBounces = 4, samplesPerFrame = 8,
    onProgress,
  } = opts;
  if (typeof window === 'undefined' || typeof document === 'undefined') throw new Error('no DOM');
  const scene = _liveScene();
  if (!scene) throw new Error('no live scene');
  const vp = window.__archdiscViewport;
  const renderer = (vp && vp.renderer) || window.__archdiscRenderer;
  if (!renderer) throw new Error('no THREE renderer');

  const support = probeSupport(renderer);
  if (!support.supported) throw new Error('GPU PT unsupported: ' + support.reason);

  // pixelStride 1 → full-resolution trace + readback (this is a final
  // frame, not the realtime preview).
  const gpu = createRenderer({ renderer, width, height, pixelStride: 1 });
  try {
    if (typeof gpu.setMaxBounces === 'function') gpu.setMaxBounces(maxBounces);
    if (typeof gpu.setSamplesPerFrame === 'function') gpu.setSamplesPerFrame(samplesPerFrame);
    const pack = gpu.rebuildScene(scene);
    if (!pack || pack.triCount === 0) throw new Error('no traceable geometry');

    const cam = _frameCamera(_partBox(scene), width / height);

    let samples = 0, last = null, guard = 0;
    while (samples < maxSamples && guard < maxSamples * 4 + 50) {
      guard++;
      const out = gpu.runFrame(cam);
      if (!out || !out.ok) break;
      samples = out.samples || (samples + 1);
      last = out.pixels;
      if (onProgress) { try { onProgress({ sample: samples, total: maxSamples }); } catch (_) {} }
      if (guard % 4 === 0) await new Promise((r) => requestAnimationFrame(r));
    }
    if (!last) throw new Error('no frame produced');
    // displayPixelBuf is traceW×traceH; at stride 1 that is width×height.
    const dataUrl = _bufToDataUrl(last, width, height);
    return { ok: true, dataUrl, samples, triCount: pack.triCount };
  } finally {
    try { gpu.dispose(); } catch (_) {}
  }
}

if (typeof window !== 'undefined') {
  window.__studioRunPathTracedOffscreenRender = runPathTracedOffscreenRender;
}
