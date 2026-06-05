// ArchDisc Studio V3 — path tracer overlay canvas.
//
// Owns a <canvas data-studio-v3-rt-overlay> element sized to the Viewport3D
// canvas. The canvas is mounted inside `.studio-viewport` (same host as
// the HUD overlays in api.js) so it tracks the viewport rectangle without
// any extra resize plumbing. Its 2D context is cleared with rgba(0,0,0,0)
// every frame so wireframe gizmos / grid lines remain visible at the
// edges of accumulated rectangles — the pathtracer fills it back in by
// drawing an ImageData built from the accumulation buffer.
//
// The overlay never intercepts pointer events (pointer-events: none) so
// orbit/transform interactions keep working while the tracer renders.
//
// Public API:
//   mountOverlay() → { canvas, ctx, host, dispose }
//   getOverlay()   → current mount or null
//   unmountOverlay()
//   paintBuffer(buf) — uploads composeImageData(buf) into the canvas
//   resizeToViewport(buf?) — keeps canvas pixel size matching viewport DPR

import { composeImageData, resizeBuffer } from './buffer.js';

let _mount = null;

function _findHost() {
  if (typeof document === 'undefined') return null;
  // Slice 664-ish convention: HUD host lives inside .studio-viewport.
  return document.querySelector('.studio-viewport') || document.body;
}

function _viewportSize() {
  const vp = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  if (vp && vp.renderer && vp.renderer.domElement) {
    const el = vp.renderer.domElement;
    // Use CSS pixel size (clientWidth/Height) — we accumulate in CSS
    // pixels, not device pixels, to keep the ray budget sane on retina.
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
  canvas.setAttribute('data-studio-v3-rt-overlay', '');
  canvas.width = width;
  canvas.height = height;
  canvas.style.cssText = [
    'position:absolute',
    'inset:0',
    'width:100%',
    'height:100%',
    // Above the WebGL canvas (z-index 0) and the gizmos but below the
    // floating HUD chrome (z-index 50+).
    'z-index:20',
    'pointer-events:none',
    // mix-blend so the wireframe gizmos still poke through dim tracer
    // regions on dark surfaces. Without this the partial opacity hides
    // selection outlines completely once samples accumulate.
    'mix-blend-mode:normal',
  ].join(';');
  // Host must allow absolute children to anchor to its box. .studio-viewport
  // is already position:relative in the shell stylesheet, but the body
  // fallback isn't — guard with an explicit anchor div if needed.
  if (host === document.body) {
    canvas.style.position = 'fixed';
  }
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.imageSmoothingEnabled = false;
  _mount = { canvas, ctx, host, dispose: unmountOverlay };
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

export function resizeToViewport(buf) {
  if (!_mount) return false;
  const { width, height } = _viewportSize();
  const canvas = _mount.canvas;
  const dirty = (canvas.width !== width) || (canvas.height !== height);
  if (dirty) {
    canvas.width = width;
    canvas.height = height;
    if (buf) resizeBuffer(buf, width, height);
  }
  return dirty;
}

export function paintBuffer(buf) {
  if (!_mount || !buf) return false;
  const { canvas, ctx } = _mount;
  if (!ctx) return false;
  if (canvas.width !== buf.width || canvas.height !== buf.height) {
    // Defensive — should have been caught by resizeToViewport. Resize the
    // buffer to match the canvas so ImageData width matches the context.
    resizeBuffer(buf, canvas.width, canvas.height);
  }
  const rgba = composeImageData(buf);
  if (!rgba) return false;
  // Clear with full transparency so old accumulation regions don't bleed
  // into the new frame after a reset.
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  try {
    const img = new ImageData(rgba, buf.width, buf.height);
    ctx.putImageData(img, 0, 0);
  } catch (_) {
    // Some headless contexts (jsdom etc.) lack ImageData — drop quietly.
    return false;
  }
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
