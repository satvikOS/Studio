// ArchDisc Studio V3 — VSE composition.
//
// composeAt(t, [outCanvas]) paints every strip active at time t into a
// single 2D canvas, bottom channel up. Returns:
//   { ok, canvas, dataUrl, width, height, painted }
//
// Strategy:
//   • Gather active strips, sorted by channel ascending.
//   • For each:
//       - image     → draw the cached <img> straight onto the canvas.
//                     If the dataURL hasn't been decoded yet, decode it
//                     synchronously via an <img> element with explicit
//                     fallback when the image is still loading.
//       - viewport  → call __studioExportSnapshotPng() to capture the
//                     LIVE viewport at the current scrub time. Falls
//                     back to a procedural gradient when no viewport
//                     exists (tests don't always have one mounted).
//       - colorcorrect → read back the current canvas's ImageData, apply
//                     gain/gamma/contrast/tint per-pixel, putImageData.
//                     Means colorcorrect MUST sit on a higher channel
//                     than the channel(s) it's meant to grade — which
//                     is exactly the Blender VSE convention.
//
// composeAt is synchronous. For image strips, we keep a per-strip
// <img> cache so repeated scrubs don't re-decode the dataURL. The
// cache is populated from a one-shot async preload kicked off the
// first time we see a new dataURL. Until the image lands, the
// strip is drawn as a placeholder rectangle so the user sees
// progress instead of an invisible gap.

import { activeAt } from './timeline.js';

const DEFAULT_W = 640;
const DEFAULT_H = 360;

// Strips → <img> cache so we don't re-decode on every scrub.
const _imgCache = new Map();        // dataUrl → HTMLImageElement
const _imgLoading = new Map();      // dataUrl → Promise<HTMLImageElement>

function ensureImage(dataUrl) {
  if (!dataUrl) return null;
  const cached = _imgCache.get(dataUrl);
  if (cached && cached.complete && cached.naturalWidth) return cached;
  if (_imgLoading.has(dataUrl)) return null;
  // Kick off a load.
  const img = new Image();
  const p = new Promise((resolve) => {
    img.onload = () => { _imgCache.set(dataUrl, img); _imgLoading.delete(dataUrl); resolve(img); };
    img.onerror = () => { _imgLoading.delete(dataUrl); resolve(null); };
  });
  _imgLoading.set(dataUrl, p);
  img.src = dataUrl;
  // If the dataURL is a pure base64 (i.e. no network) most browsers
  // resolve synchronously by the time we paint a few ms later, but
  // not guaranteed. The first compose returns a placeholder; the
  // editor will tick again and the real image will land.
  if (img.complete && img.naturalWidth) {
    _imgCache.set(dataUrl, img);
    _imgLoading.delete(dataUrl);
    return img;
  }
  return null;
}

// Public preload — used by the editor when the user drops a new
// dataURL so the first paint already has the decoded image. Returns
// a Promise that resolves to the decoded <img> (or null on error).
export function preloadImage(dataUrl) {
  if (!dataUrl) return Promise.resolve(null);
  const cached = _imgCache.get(dataUrl);
  if (cached && cached.complete && cached.naturalWidth) return Promise.resolve(cached);
  if (_imgLoading.has(dataUrl)) return _imgLoading.get(dataUrl);
  const img = new Image();
  const p = new Promise((resolve) => {
    img.onload = () => { _imgCache.set(dataUrl, img); _imgLoading.delete(dataUrl); resolve(img); };
    img.onerror = () => { _imgLoading.delete(dataUrl); resolve(null); };
  });
  _imgLoading.set(dataUrl, p);
  img.src = dataUrl;
  return p;
}

function makeCanvas(w, h) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function fillBlack(ctx, w, h) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
}

// Drawing helpers ────────────────────────────────────────────────────

function drawImageStrip(ctx, strip, w, h) {
  const url = strip.params && strip.params.dataUrl;
  if (!url) {
    drawPlaceholder(ctx, w, h, '(no image)', 'rgba(154,166,178,0.55)');
    return false;
  }
  const img = ensureImage(url);
  if (!img) {
    drawPlaceholder(ctx, w, h, 'image loading…', 'rgba(29,233,182,0.4)');
    return false;
  }
  // Contain-fit: scale-to-fit preserving aspect, letterboxed.
  const ar = img.naturalWidth / img.naturalHeight;
  const tar = w / h;
  let dw = w; let dh = h;
  if (ar > tar) { dh = Math.round(w / ar); }
  else          { dw = Math.round(h * ar); }
  const dx = Math.round((w - dw) / 2);
  const dy = Math.round((h - dh) / 2);
  ctx.drawImage(img, dx, dy, dw, dh);
  return true;
}

function drawViewportStrip(ctx, strip, w, h) {
  // Pull the live frame via the global op from api.js (slice 639).
  if (typeof window === 'undefined') {
    drawPlaceholder(ctx, w, h, 'no window', 'rgba(154,166,178,0.55)');
    return false;
  }
  const exporter = window.__studioExportSnapshotPng;
  if (typeof exporter !== 'function') {
    drawPlaceholder(ctx, w, h, '(no viewport)', 'rgba(154,166,178,0.55)');
    return false;
  }
  let snap = null;
  try {
    snap = exporter(strip.params.width || w, strip.params.height || h);
  } catch (_) { snap = null; }
  if (!snap || !snap.ok || !snap.dataUrl) {
    drawPlaceholder(ctx, w, h, '(no viewport)', 'rgba(154,166,178,0.55)');
    return false;
  }
  // Decode the freshly captured frame synchronously through our cache.
  // The dataURL changes every call (live capture) so we DO end up
  // creating a new <Image> each time — that's the price of "live
  // viewport". For repeated scrubs at the same time, the underlying
  // renderer.toDataURL() call is the dominant cost anyway.
  const img = ensureImage(snap.dataUrl);
  if (!img) {
    // First-time decode hasn't landed yet — paint a transient placeholder
    // so the canvas isn't empty. The next compose will land the real frame.
    drawPlaceholder(ctx, w, h, 'capture decoding…', 'rgba(29,233,182,0.4)');
    return false;
  }
  const ar = img.naturalWidth / img.naturalHeight;
  const tar = w / h;
  let dw = w; let dh = h;
  if (ar > tar) { dh = Math.round(w / ar); }
  else          { dw = Math.round(h * ar); }
  const dx = Math.round((w - dw) / 2);
  const dy = Math.round((h - dh) / 2);
  ctx.drawImage(img, dx, dy, dw, dh);
  return true;
}

function applyColorCorrect(ctx, strip, w, h) {
  // Mutate the buffer below us. Reading and writing the full ImageData
  // is O(w·h) but identical to what Blender's VSE strip transform does.
  let id;
  try { id = ctx.getImageData(0, 0, w, h); }
  catch (_) { return false; }
  const d = id.data;
  const gain = +strip.params.gain || 1.0;
  const gamma = Math.max(0.05, +strip.params.gamma || 1.0);
  const contrast = +strip.params.contrast || 1.0;
  const tint = Array.isArray(strip.params.tint) ? strip.params.tint : [1, 1, 1];
  const invG = 1 / gamma;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i]     / 255;
    let g = d[i + 1] / 255;
    let b = d[i + 2] / 255;
    // gain
    r *= gain; g *= gain; b *= gain;
    // tint
    r *= tint[0]; g *= tint[1]; b *= tint[2];
    // gamma (pow with invG so gamma>1 → brighter mids, like Blender).
    r = r > 0 ? Math.pow(r, invG) : 0;
    g = g > 0 ? Math.pow(g, invG) : 0;
    b = b > 0 ? Math.pow(b, invG) : 0;
    // contrast around 0.5
    r = (r - 0.5) * contrast + 0.5;
    g = (g - 0.5) * contrast + 0.5;
    b = (b - 0.5) * contrast + 0.5;
    d[i]     = Math.max(0, Math.min(255, Math.round(r * 255)));
    d[i + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
    d[i + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
    // leave alpha alone
  }
  ctx.putImageData(id, 0, 0);
  return true;
}

function drawPlaceholder(ctx, w, h, label, colour) {
  ctx.save();
  ctx.fillStyle = 'rgba(13,17,23,0.6)';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = colour || 'rgba(154,166,178,0.55)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  ctx.fillStyle = colour || 'rgba(154,166,178,0.85)';
  ctx.font = '12px ui-monospace, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label || '', w / 2, h / 2);
  ctx.restore();
}

// ─── Public compose ─────────────────────────────────────────────────

export function composeAt(t, optsOrCanvas) {
  const opts = (optsOrCanvas && optsOrCanvas.nodeType === undefined) ? optsOrCanvas : {};
  const outCanvas = (optsOrCanvas && optsOrCanvas.nodeType !== undefined) ? optsOrCanvas : opts.canvas;
  const w = Math.max(64, Math.floor(opts.width || DEFAULT_W));
  const h = Math.max(64, Math.floor(opts.height || DEFAULT_H));
  const canvas = outCanvas || makeCanvas(w, h);
  if (!canvas) return { ok: false, error: 'no canvas' };
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext('2d');
  fillBlack(ctx, w, h);

  const strips = activeAt(t);
  let painted = 0;
  for (const s of strips) {
    if (s.kind === 'image') {
      if (drawImageStrip(ctx, s, w, h)) painted += 1;
    } else if (s.kind === 'viewport') {
      if (drawViewportStrip(ctx, s, w, h)) painted += 1;
    } else if (s.kind === 'colorcorrect') {
      if (applyColorCorrect(ctx, s, w, h)) painted += 1;
    }
  }

  let dataUrl = null;
  try { dataUrl = canvas.toDataURL('image/png'); } catch (_) { dataUrl = null; }
  return {
    ok: true,
    canvas,
    dataUrl,
    width: w,
    height: h,
    painted,
    activeCount: strips.length,
  };
}

// Render N evenly-spaced frames covering [0, durationSec]. Returns
// an array of PNG dataURLs.
export function exportSequence(fps, durationSec, opts) {
  const _fps = Math.max(1, Math.floor(Number(fps) || 12));
  const _dur = Math.max(0, Number(durationSec) || 0);
  if (_dur <= 0) return { ok: false, error: 'durationSec must be > 0', frames: [] };
  const n = Math.max(1, Math.round(_fps * _dur));
  const out = [];
  const w = (opts && opts.width)  || DEFAULT_W;
  const h = (opts && opts.height) || DEFAULT_H;
  // Reuse a single canvas across frames to avoid GC churn.
  const canvas = makeCanvas(w, h);
  for (let i = 0; i < n; i += 1) {
    // Frame i sits at t = i / fps, NOT i / (n - 1), so a 1-second
    // 24-fps export yields frames at 0, 1/24, 2/24, … 23/24 — the
    // standard "exclusive end" film cadence.
    const t = i / _fps;
    const r = composeAt(t, { canvas, width: w, height: h });
    out.push(r.dataUrl || '');
  }
  return { ok: true, frames: out, count: out.length, fps: _fps, durationSec: _dur };
}

// For tests + the install layer: clear any cached <img> objects.
export function clearImageCache() {
  _imgCache.clear();
  _imgLoading.clear();
}
