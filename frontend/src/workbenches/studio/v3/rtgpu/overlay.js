// ArchDisc Studio V3 — GPU path tracer overlay canvas.
//
// Mirrors the existing CPU tracer overlay (`rt/overlay.js`) in shape:
// owns a single <canvas> tagged `data-studio-v3-rtgpu-overlay`,
// mounted inside `.studio-viewport` so it tracks the viewport's
// rectangle and never intercepts pointer events. The renderer hands
// us a Uint8Array of pixel data (read back from displayRT via
// readRenderTargetPixels) and we blit it into a 2D context.
//
// The data is delivered in WebGL's bottom-up order so we flip Y when
// composing the ImageData rows. We never upscale: the canvas is sized
// to the viewport's full client-pixel rect and the trace pixels are
// drawn at their native (lower) resolution via `drawImage()` from an
// off-DOM canvas — that gives a clean nearest-neighbour blow-up on
// quarter-resolution traces without per-pixel JS work.
//
// Public API:
//   mountOverlay()  → { canvas, ctx, host, dispose }
//   getOverlay()    → current mount or null
//   unmountOverlay()
//   blitPixels(traceW, traceH, uint8RGBA)
//   snapshotDataUrl() → PNG data URL or null

let _mount = null;

function _findHost() {
  if (typeof document === 'undefined') return null;
  return document.querySelector('.studio-viewport') || document.body;
}

function _viewportSize() {
  const vp = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  if (vp && vp.renderer && vp.renderer.domElement) {
    const el = vp.renderer.domElement;
    return {
      width: Math.max(64, el.clientWidth | 0),
      height: Math.max(64, el.clientHeight | 0),
    };
  }
  const host = _findHost();
  if (host && host.clientWidth && host.clientHeight) {
    return { width: host.clientWidth | 0, height: host.clientHeight | 0 };
  }
  return { width: 640, height: 480 };
}

export function mountOverlay() {
  if (_mount) return _mount;
  if (typeof document === 'undefined') return null;
  const host = _findHost();
  if (!host) return null;
  const { width, height } = _viewportSize();
  const canvas = document.createElement('canvas');
  canvas.setAttribute('data-studio-v3-rtgpu-overlay', '');
  canvas.width = width;
  canvas.height = height;
  canvas.style.cssText = [
    'position:absolute',
    'inset:0',
    'width:100%',
    'height:100%',
    // Above the WebGL canvas + below floating chrome — same z-stacking
    // convention as the CPU tracer's overlay.
    'z-index:21',
    'pointer-events:none',
    'mix-blend-mode:normal',
  ].join(';');
  if (host === document.body) {
    canvas.style.position = 'fixed';
  }
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.imageSmoothingEnabled = false;
  // Off-DOM canvas used to upscale the low-res trace via drawImage.
  const traceCanvas = (typeof document !== 'undefined')
    ? document.createElement('canvas')
    : null;
  const traceCtx = traceCanvas ? traceCanvas.getContext('2d') : null;
  _mount = { canvas, ctx, host, traceCanvas, traceCtx, dispose: unmountOverlay };
  return _mount;
}

export function getOverlay() {
  return _mount;
}

export function unmountOverlay() {
  if (!_mount) return;
  const { canvas } = _mount;
  if (canvas && canvas.parentNode) canvas.parentNode.removeChild(canvas);
  _mount = null;
}

export function resizeToViewport() {
  if (!_mount) return false;
  const { width, height } = _viewportSize();
  const canvas = _mount.canvas;
  const dirty = (canvas.width !== width) || (canvas.height !== height);
  if (dirty) {
    canvas.width = width;
    canvas.height = height;
  }
  return dirty;
}

// Push a trace frame (low-res RGBA bytes, bottom-up rows) into the
// overlay canvas. We populate a same-sized off-DOM canvas first then
// drawImage that into the full-size overlay so the browser does a
// hardware-accelerated nearest-neighbour upscale.
export function blitPixels(traceW, traceH, rgba) {
  if (!_mount) return false;
  const { canvas, ctx, traceCanvas, traceCtx } = _mount;
  if (!ctx || !traceCanvas || !traceCtx || !rgba) return false;
  if (traceCanvas.width !== traceW || traceCanvas.height !== traceH) {
    traceCanvas.width = traceW;
    traceCanvas.height = traceH;
  }
  // Flip Y while copying into a fresh Uint8ClampedArray for ImageData.
  // WebGL readPixels delivers row 0 at the bottom of the image; canvas
  // ImageData expects row 0 at the top.
  const flipped = new Uint8ClampedArray(traceW * traceH * 4);
  for (let y = 0; y < traceH; y++) {
    const srcRow = (traceH - 1 - y) * traceW * 4;
    const dstRow = y * traceW * 4;
    flipped.set(rgba.subarray(srcRow, srcRow + traceW * 4), dstRow);
  }
  let img;
  try {
    img = new ImageData(flipped, traceW, traceH);
  } catch (_) {
    return false;
  }
  traceCtx.putImageData(img, 0, 0);
  // Clear overlay then upscale-blit. Nearest-neighbour preserves the
  // characteristic "block" pixellation of quarter-res traces, which
  // doubles as a visual hint that the preview is still converging.
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(traceCanvas, 0, 0, canvas.width, canvas.height);
  return true;
}

export function snapshotDataUrl() {
  if (!_mount || !_mount.canvas) return null;
  try {
    return _mount.canvas.toDataURL('image/png');
  } catch (_) {
    return null;
  }
}
