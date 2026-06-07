// ArchDisc Studio V3 — stress test screenshotter (slice 788).
//
// Render the live viewport's `(scene, camera)` into an off-screen
// WebGLRenderTarget at an arbitrary target resolution (default 4K =
// 3840×2160), then read it back as a PNG data URL. The live viewport
// renderer's drawing buffer is left untouched so the on-screen
// presentation doesn't flicker between resolutions.
//
// Two render paths:
//   1) FAST PATH: temporarily resize the live renderer to the target
//      resolution, call `renderer.render(scene, camera)`, snapshot the
//      drawing-buffer canvas, then restore the original size. This
//      respects every renderer setting (post-processing pass, tone
//      mapping, etc.). The live canvas blinks once during the
//      resize/restore — acceptable for an explicit "render at 4K" op.
//   2) OFFSCREEN PATH (preferred): create a fresh
//      `WebGLRenderTarget(W, H)` + a one-shot off-screen renderer,
//      render the scene into it, read the pixel buffer back and encode
//      to PNG via a 2D-canvas blit. No live-canvas flicker.
//
// Path 2 is the default; path 1 falls back when offscreen rendering
// trips on missing renderer state (no live renderer reachable, etc.).
//
// Returns Promise<{ ok, dataUrl, width, height, renderTimeMs, path }>.

import * as THREE from 'three';

// Find the live renderer + scene + camera handed out by Viewport3D's
// `window.__archdiscViewport` (slice 396) without throwing if the
// viewport isn't mounted.
function _getViewport() {
  if (typeof window === 'undefined') return null;
  const vp = window.__archdiscViewport;
  if (!vp) return null;
  if (!vp.renderer || !vp.scene || !vp.camera) return null;
  return vp;
}

// Read pixels out of a WebGLRenderTarget into a Uint8Array of length
// W*H*4 (RGBA). Pixels come back FLIPPED in WebGL (origin bottom-left)
// — we y-flip during the 2D-canvas blit below.
function _readPixels(renderer, target, width, height) {
  const buf = new Uint8Array(width * height * 4);
  renderer.readRenderTargetPixels(target, 0, 0, width, height, buf);
  return buf;
}

// Encode a y-flipped RGBA Uint8Array as a PNG data URL via a 2D canvas.
function _encodePNG(rgba, width, height) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('screenshotter: no 2d context');
  const img = ctx.createImageData(width, height);
  // y-flip the WebGL buffer (origin bottom-left → top-left).
  const dst = img.data;
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const srcRow = (height - 1 - y) * rowBytes;
    const dstRow = y * rowBytes;
    for (let x = 0; x < rowBytes; x++) dst[dstRow + x] = rgba[srcRow + x];
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

// Render the live viewport at `targetW × targetH` via an off-screen
// WebGLRenderTarget. Returns a PNG data URL string. Throws if the
// target / renderer cannot be created.
function _offscreenRender(viewport, targetW, targetH) {
  const { renderer, scene, camera } = viewport;
  // Build the render target sized to the request. Use uint8 RGBA so
  // we can read pixels back directly (float RT would need a conversion
  // pass to encode to PNG anyway). MSAA samples=4 for clean edges at
  // 4K; THREE's WebGLRenderer downsamples automatically on read.
  const rt = new THREE.WebGLRenderTarget(targetW, targetH, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
    samples: 4,
  });
  // Snapshot the camera's projection state, retarget for the
  // off-screen aspect, render, then restore.
  const prevAspect = camera.aspect;
  const prevTarget = renderer.getRenderTarget();
  const prevAR = renderer.autoClear;
  try {
    if (Number.isFinite(prevAspect)) {
      camera.aspect = targetW / targetH;
      camera.updateProjectionMatrix();
    }
    renderer.setRenderTarget(rt);
    renderer.autoClear = true;
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAR;
    if (Number.isFinite(prevAspect)) {
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
    }
    const pixels = _readPixels(renderer, rt, targetW, targetH);
    return _encodePNG(pixels, targetW, targetH);
  } finally {
    try { rt.dispose(); } catch (_) { /* swallow */ }
    // Defensive restore in case the try-block bailed mid-render.
    try { renderer.setRenderTarget(prevTarget); } catch (_) {}
    try { renderer.autoClear = prevAR; } catch (_) {}
    if (Number.isFinite(prevAspect) && camera.aspect !== prevAspect) {
      try {
        camera.aspect = prevAspect;
        camera.updateProjectionMatrix();
      } catch (_) {}
    }
  }
}

// FAST_PATH fallback: rescale the live renderer's drawing buffer,
// render, snapshot, restore. Causes a brief on-screen flicker.
function _liveCanvasRender(viewport, targetW, targetH) {
  const { renderer, scene, camera } = viewport;
  const prevSize = renderer.getSize(new THREE.Vector2());
  const prevPR = renderer.getPixelRatio();
  const prevAspect = camera.aspect;
  try {
    renderer.setPixelRatio(1);
    renderer.setSize(targetW, targetH, false);
    camera.aspect = targetW / targetH;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    const dataUrl = renderer.domElement.toDataURL('image/png');
    return dataUrl;
  } finally {
    try { renderer.setPixelRatio(prevPR); } catch (_) {}
    try { renderer.setSize(prevSize.x, prevSize.y, false); } catch (_) {}
    try {
      camera.aspect = prevAspect;
      camera.updateProjectionMatrix();
    } catch (_) {}
  }
}

// Public API.
//
//   captureScreenshot({ width, height, path })
//     width:  number (default 3840)
//     height: number (default 2160)
//     path:   'offscreen' | 'live' (default 'offscreen')
//
// Returns Promise<{ ok, dataUrl, width, height, renderTimeMs, path }>.
export async function captureScreenshot(opts) {
  const o = opts || {};
  const width = Number.isFinite(+o.width) ? Math.max(16, Math.floor(+o.width)) : 3840;
  const height = Number.isFinite(+o.height) ? Math.max(16, Math.floor(+o.height)) : 2160;
  const requestedPath = o.path === 'live' ? 'live' : 'offscreen';

  const viewport = _getViewport();
  if (!viewport) {
    return { ok: false, error: 'no live viewport', width, height,
             renderTimeMs: 0, path: requestedPath };
  }

  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  let dataUrl = null;
  let chosen = requestedPath;
  let error = null;
  try {
    if (requestedPath === 'live') {
      dataUrl = _liveCanvasRender(viewport, width, height);
    } else {
      dataUrl = _offscreenRender(viewport, width, height);
    }
  } catch (e) {
    error = e && e.message ? e.message : String(e);
    // Fall through to the alternate path. This is the documented
    // fallback chain — never silently hide a failure.
    try {
      if (requestedPath === 'offscreen') {
        dataUrl = _liveCanvasRender(viewport, width, height);
        chosen = 'live';
      } else {
        dataUrl = _offscreenRender(viewport, width, height);
        chosen = 'offscreen';
      }
    } catch (e2) {
      return {
        ok: false,
        error: error + '; fallback failed: ' + (e2 && e2.message ? e2.message : String(e2)),
        width, height, renderTimeMs: 0, path: chosen,
      };
    }
  }
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  return {
    ok: true,
    dataUrl,
    width,
    height,
    renderTimeMs: t1 - t0,
    path: chosen,
  };
}

export default captureScreenshot;
