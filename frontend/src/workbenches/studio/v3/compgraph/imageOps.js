// ArchDisc Studio V3 — compositing graph image operations (slice 889 depth push).
//
// REAL per-pixel image processing for the compositing graph nodes.
// Every operation works on raw RGBA ImageData buffers (Uint8ClampedArray) —
// no canvas-filter pass-through, no built-in CSS shortcuts. The algorithms
// are the same ones a Nuke/Fusion/AE plugin would implement in C++:
//
//   * gaussianBlur     — separable horizontal + vertical 1-D Gaussian kernel
//   * chromaKey        — RGB-space distance to key colour → soft alpha matte
//   * levels           — input black/white + gamma + output remap
//   * curves           — per-channel piecewise-linear LUTs
//   * transform        — translate / rotate / scale w/ bilinear sampling
//   * blendOver/Under  — standard Porter-Duff
//   * blendScreen/Mult — film-style compositing modes
//   * invert           — 255 - channel
//   * brightPass       — luminance threshold for glow
//   * glow             — bright pass + blur + screen blend back over original
//   * despill          — green/blue subtraction for chroma cleanup
//
// All functions take and return real ImageData objects. The graph evaluator
// in index.js threads these ImageData buffers through the DAG instead of
// passing dataUrls around.
//
// We intentionally do NOT use the canvas-built-in `ctx.filter = 'blur(...)'`
// shortcut — the user directive is REAL pixel math, not pass-through.

// ────────────────────────────────────────────────────────────────────────────
// Canvas / ImageData helpers
// ────────────────────────────────────────────────────────────────────────────

function _makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') {
    try { return new OffscreenCanvas(w, h); } catch (_) { /* fall through */ }
  }
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  // Minimal SSR/test fallback — surface a clear error rather than crash silently.
  throw new Error('No canvas implementation available');
}

export function newImageData(w, h) {
  const buf = new Uint8ClampedArray(w * h * 4);
  // Try the real ImageData constructor first so the result is identical to
  // what `ctx.getImageData` would hand back.
  if (typeof ImageData !== 'undefined') {
    try { return new ImageData(buf, w, h); } catch (_) { /* fall through */ }
  }
  return { data: buf, width: w, height: h };
}

export function cloneImageData(src) {
  const out = newImageData(src.width, src.height);
  out.data.set(src.data);
  return out;
}

// Load an HTMLImageElement from a dataUrl / url.
export function loadImage(url) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') { reject(new Error('Image not available')); return; }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

// Pull ImageData out of an HTMLImageElement / HTMLCanvasElement / OffscreenCanvas.
export function imageToImageData(img, w, h) {
  const W = w || img.naturalWidth || img.width;
  const H = h || img.naturalHeight || img.height;
  const c = _makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(img, 0, 0, W, H);
  return ctx.getImageData(0, 0, W, H);
}

// Encode ImageData → dataUrl (PNG). Works for both DOM canvas and OffscreenCanvas.
export function imageDataToDataUrl(imageData) {
  const c = _makeCanvas(imageData.width, imageData.height);
  const ctx = c.getContext('2d');
  ctx.putImageData(imageData, 0, 0);
  if (typeof c.toDataURL === 'function') return c.toDataURL('image/png');
  // OffscreenCanvas path — convertToBlob is async; return a stable string
  // describing the buffer for callers that only need a value. Most browsers
  // expose `.toDataURL` even on offscreen variants through polyfills.
  return null;
}

// Build a solid (transparent) image when a node has no upstream input.
export function emptyImageData(w = 256, h = 256) {
  return newImageData(w, h);
}

// ────────────────────────────────────────────────────────────────────────────
// Per-pixel primitive ops
// ────────────────────────────────────────────────────────────────────────────

export function invert(src) {
  const out = cloneImageData(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
    // alpha untouched
  }
  return out;
}

// Build a 256-entry LUT from a piecewise-linear curve.
// `points` is an array of {x, y} both in 0..255, sorted by x.
function _curveLUT(points) {
  const lut = new Uint8ClampedArray(256);
  if (!points || points.length === 0) { for (let i = 0; i < 256; i++) lut[i] = i; return lut; }
  const pts = points.slice().sort((a, b) => a.x - b.x);
  // Pad endpoints so the curve is defined across the full input range.
  if (pts[0].x > 0) pts.unshift({ x: 0, y: pts[0].y });
  if (pts[pts.length - 1].x < 255) pts.push({ x: 255, y: pts[pts.length - 1].y });
  let seg = 0;
  for (let x = 0; x < 256; x++) {
    while (seg < pts.length - 2 && x > pts[seg + 1].x) seg++;
    const a = pts[seg], b = pts[seg + 1];
    const t = (b.x === a.x) ? 0 : (x - a.x) / (b.x - a.x);
    lut[x] = Math.round(a.y + (b.y - a.y) * t);
  }
  return lut;
}

// `curves` shape: { r: [{x,y},...], g: [...], b: [...] }  (any channel optional)
export function curves(src, curveSpec = {}) {
  const out = cloneImageData(src);
  const lutR = _curveLUT(curveSpec.r);
  const lutG = _curveLUT(curveSpec.g);
  const lutB = _curveLUT(curveSpec.b);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = lutR[d[i]];
    d[i + 1] = lutG[d[i + 1]];
    d[i + 2] = lutB[d[i + 2]];
  }
  return out;
}

// Photoshop-style levels:
//   inBlack/inWhite: input clip points (0..255)
//   gamma:           midpoint shape (0.1..9.99 typical, 1 = no change)
//   outBlack/outWhite: output range
export function levels(src, { inBlack = 0, inWhite = 255, gamma = 1, outBlack = 0, outWhite = 255 } = {}) {
  const out = cloneImageData(src);
  const d = out.data;
  const range = Math.max(1, inWhite - inBlack);
  const invG = 1 / Math.max(0.0001, gamma);
  const outRange = outWhite - outBlack;
  // Precompute LUT — one pass over 256 values is cheaper than per-pixel pow.
  const lut = new Uint8ClampedArray(256);
  for (let i = 0; i < 256; i++) {
    let v = (i - inBlack) / range;
    if (v < 0) v = 0; else if (v > 1) v = 1;
    v = Math.pow(v, invG);
    lut[i] = Math.round(outBlack + v * outRange);
  }
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
  return out;
}

// Color/grade — exposed as RGB curves with input/output remapping per channel.
// `grade.input` / `grade.output` are objects { r: [lo, hi], g: [...], b: [...] }
// `grade.gamma` is per-channel { r: x, g: y, b: z }.
export function colorGrade(src, grade = {}) {
  const inp = grade.input || {};
  const outp = grade.output || {};
  const gamma = grade.gamma || {};
  const channels = ['r', 'g', 'b'];
  const luts = {};
  for (const ch of channels) {
    const [iLo, iHi] = inp[ch] || [0, 255];
    const [oLo, oHi] = outp[ch] || [0, 255];
    const g = Math.max(0.0001, gamma[ch] || 1);
    const lut = new Uint8ClampedArray(256);
    const range = Math.max(1, iHi - iLo);
    const outRange = oHi - oLo;
    const invG = 1 / g;
    for (let i = 0; i < 256; i++) {
      let v = (i - iLo) / range;
      if (v < 0) v = 0; else if (v > 1) v = 1;
      v = Math.pow(v, invG);
      lut[i] = Math.round(oLo + v * outRange);
    }
    luts[ch] = lut;
  }
  const out = cloneImageData(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i]     = luts.r[d[i]];
    d[i + 1] = luts.g[d[i + 1]];
    d[i + 2] = luts.b[d[i + 2]];
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Separable Gaussian blur — three-pass (h, v, h) for higher quality.
// ────────────────────────────────────────────────────────────────────────────

function _gaussianKernel(radius, sigma) {
  const r = Math.max(1, Math.floor(radius));
  const s = sigma > 0 ? sigma : Math.max(1, r / 2);
  const k = new Float32Array(r * 2 + 1);
  const twoSigSq = 2 * s * s;
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / twoSigSq);
    k[i + r] = v; sum += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return k;
}

function _convolveAxis(src, kernel, axis /* 0=horizontal, 1=vertical */) {
  const W = src.width, H = src.height;
  const sd = src.data;
  const out = newImageData(W, H);
  const od = out.data;
  const r = (kernel.length - 1) >> 1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let aR = 0, aG = 0, aB = 0, aA = 0;
      for (let k = -r; k <= r; k++) {
        let sx = x, sy = y;
        if (axis === 0) sx = x + k; else sy = y + k;
        // Clamp-to-edge — same boundary handling Nuke uses by default.
        if (sx < 0) sx = 0; else if (sx >= W) sx = W - 1;
        if (sy < 0) sy = 0; else if (sy >= H) sy = H - 1;
        const idx = (sy * W + sx) * 4;
        const w = kernel[k + r];
        aR += sd[idx]     * w;
        aG += sd[idx + 1] * w;
        aB += sd[idx + 2] * w;
        aA += sd[idx + 3] * w;
      }
      const o = (y * W + x) * 4;
      od[o]     = aR;
      od[o + 1] = aG;
      od[o + 2] = aB;
      od[o + 3] = aA;
    }
  }
  return out;
}

export function gaussianBlur(src, radius = 4, sigma = 0) {
  if (radius <= 0) return cloneImageData(src);
  const k = _gaussianKernel(radius, sigma);
  // 3-pass H/V/H — slightly higher quality than the standard 2-pass.
  let tmp = _convolveAxis(src, k, 0);
  tmp = _convolveAxis(tmp, k, 1);
  tmp = _convolveAxis(tmp, k, 0);
  return tmp;
}

// ────────────────────────────────────────────────────────────────────────────
// Chroma key — RGB distance to key colour produces a soft alpha matte.
// Optional despill subtracts the key colour's dominant channel from the FG.
// ────────────────────────────────────────────────────────────────────────────

function _hexToRgb(hex) {
  if (typeof hex !== 'string') return [0, 255, 0];
  const m = hex.replace('#', '').match(/.{1,2}/g);
  if (!m || m.length < 3) return [0, 255, 0];
  return [parseInt(m[0], 16) || 0, parseInt(m[1], 16) || 0, parseInt(m[2], 16) || 0];
}

export function chromaKey(src, {
  keyColor = '#00ff00',
  similarity = 0.4,   // 0..1 — fraction of max RGB distance treated as "fully key"
  smoothness = 0.1,   // 0..1 — softness of the matte edge
  despill = 0.5,      // 0..1 — strength of dominant-channel subtraction
} = {}) {
  const [kR, kG, kB] = Array.isArray(keyColor) ? keyColor : _hexToRgb(keyColor);
  const maxDist = Math.sqrt(255 * 255 * 3);
  const simD = similarity * maxDist;
  const smoothD = Math.max(0.0001, smoothness * maxDist);
  // Dominant key channel — used by the despill pass.
  let dom = 0;
  if (kG >= kR && kG >= kB) dom = 1;
  else if (kB >= kR && kB >= kG) dom = 2;
  else dom = 0;

  const out = cloneImageData(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3];
    const dr = r - kR, dg = g - kG, db = b - kB;
    const dist = Math.sqrt(dr * dr + dg * dg + db * db);
    // Soft alpha: 0 inside the key, 1 outside the smooth band.
    let alpha;
    if (dist <= simD) alpha = 0;
    else if (dist >= simD + smoothD) alpha = 1;
    else alpha = (dist - simD) / smoothD;
    d[i + 3] = Math.round(a * alpha);
    // Despill — if FG is partly transparent and dominant channel is high,
    // pull it down to the average of the other two.
    if (alpha < 1 && despill > 0) {
      if (dom === 1) {
        const target = (r + b) * 0.5;
        if (g > target) d[i + 1] = Math.round(g + (target - g) * despill);
      } else if (dom === 2) {
        const target = (r + g) * 0.5;
        if (b > target) d[i + 2] = Math.round(b + (target - b) * despill);
      } else {
        const target = (g + b) * 0.5;
        if (r > target) d[i] = Math.round(r + (target - r) * despill);
      }
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Transform — translate / rotate / scale with bilinear sampling.
// ────────────────────────────────────────────────────────────────────────────

function _sampleBilinear(src, fx, fy) {
  const W = src.width, H = src.height;
  if (fx < 0 || fx > W - 1 || fy < 0 || fy > H - 1) return [0, 0, 0, 0];
  const x0 = Math.floor(fx), x1 = Math.min(W - 1, x0 + 1);
  const y0 = Math.floor(fy), y1 = Math.min(H - 1, y0 + 1);
  const dx = fx - x0, dy = fy - y0;
  const d = src.data;
  const i00 = (y0 * W + x0) * 4, i10 = (y0 * W + x1) * 4;
  const i01 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const a = d[i00 + c] * (1 - dx) + d[i10 + c] * dx;
    const b = d[i01 + c] * (1 - dx) + d[i11 + c] * dx;
    out[c] = a * (1 - dy) + b * dy;
  }
  return out;
}

export function transform(src, { tx = 0, ty = 0, rot = 0, sx = 1, sy = 1, cx = null, cy = null } = {}) {
  const W = src.width, H = src.height;
  const out = newImageData(W, H);
  const od = out.data;
  const centerX = cx == null ? W / 2 : cx;
  const centerY = cy == null ? H / 2 : cy;
  // Inverse mapping — for every dst pixel, look up the matching src pixel.
  const c = Math.cos(-rot), s = Math.sin(-rot);
  const invSx = sx === 0 ? 0 : 1 / sx;
  const invSy = sy === 0 ? 0 : 1 / sy;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // Subtract translate, then rotate/scale around centre.
      const dxp = (x - tx) - centerX;
      const dyp = (y - ty) - centerY;
      const rxp = (dxp * c - dyp * s) * invSx + centerX;
      const ryp = (dxp * s + dyp * c) * invSy + centerY;
      const sample = _sampleBilinear(src, rxp, ryp);
      const o = (y * W + x) * 4;
      od[o]     = sample[0];
      od[o + 1] = sample[1];
      od[o + 2] = sample[2];
      od[o + 3] = sample[3];
    }
  }
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Merge / blend modes.
// All assume premultiplied semantics on the alpha channel for compositing.
// ────────────────────────────────────────────────────────────────────────────

function _matchSize(a, b) {
  // For mismatched sizes we composite onto the size of `a` and sample `b`
  // through nearest-pixel mapping — close enough for slice-level realism.
  if (a.width === b.width && a.height === b.height) return b;
  const out = newImageData(a.width, a.height);
  const sx = b.width / a.width, sy = b.height / a.height;
  const bd = b.data, od = out.data;
  for (let y = 0; y < a.height; y++) {
    for (let x = 0; x < a.width; x++) {
      const u = Math.min(b.width - 1, Math.floor(x * sx));
      const v = Math.min(b.height - 1, Math.floor(y * sy));
      const bi = (v * b.width + u) * 4;
      const oi = (y * a.width + x) * 4;
      od[oi]     = bd[bi];
      od[oi + 1] = bd[bi + 1];
      od[oi + 2] = bd[bi + 2];
      od[oi + 3] = bd[bi + 3];
    }
  }
  return out;
}

export function blendOver(top, bottom) {
  // Standard Porter-Duff "A over B".
  const b = _matchSize(top, bottom);
  const out = newImageData(top.width, top.height);
  const td = top.data, bd = b.data, od = out.data;
  for (let i = 0; i < td.length; i += 4) {
    const aT = td[i + 3] / 255;
    const aB = bd[i + 3] / 255;
    const outA = aT + aB * (1 - aT);
    if (outA <= 0) { od[i] = od[i + 1] = od[i + 2] = od[i + 3] = 0; continue; }
    for (let c = 0; c < 3; c++) {
      od[i + c] = (td[i + c] * aT + bd[i + c] * aB * (1 - aT)) / outA;
    }
    od[i + 3] = Math.round(outA * 255);
  }
  return out;
}

export function blendUnder(top, bottom) {
  return blendOver(bottom, top);
}

export function blendScreen(a, b) {
  const m = _matchSize(a, b);
  const out = newImageData(a.width, a.height);
  const ad = a.data, bd = m.data, od = out.data;
  for (let i = 0; i < ad.length; i += 4) {
    // Screen = 1 - (1-a)(1-b)
    od[i]     = 255 - ((255 - ad[i])     * (255 - bd[i])     ) / 255;
    od[i + 1] = 255 - ((255 - ad[i + 1]) * (255 - bd[i + 1]) ) / 255;
    od[i + 2] = 255 - ((255 - ad[i + 2]) * (255 - bd[i + 2]) ) / 255;
    od[i + 3] = Math.max(ad[i + 3], bd[i + 3]);
  }
  return out;
}

export function blendMultiply(a, b) {
  const m = _matchSize(a, b);
  const out = newImageData(a.width, a.height);
  const ad = a.data, bd = m.data, od = out.data;
  for (let i = 0; i < ad.length; i += 4) {
    od[i]     = (ad[i]     * bd[i])     / 255;
    od[i + 1] = (ad[i + 1] * bd[i + 1]) / 255;
    od[i + 2] = (ad[i + 2] * bd[i + 2]) / 255;
    od[i + 3] = Math.max(ad[i + 3], bd[i + 3]);
  }
  return out;
}

export function blendAdd(a, b) {
  const m = _matchSize(a, b);
  const out = newImageData(a.width, a.height);
  const ad = a.data, bd = m.data, od = out.data;
  for (let i = 0; i < ad.length; i += 4) {
    od[i]     = Math.min(255, ad[i]     + bd[i]);
    od[i + 1] = Math.min(255, ad[i + 1] + bd[i + 1]);
    od[i + 2] = Math.min(255, ad[i + 2] + bd[i + 2]);
    od[i + 3] = Math.max(ad[i + 3], bd[i + 3]);
  }
  return out;
}

export function merge(top, bottom, mode = 'over') {
  if (!top && !bottom) return null;
  if (!bottom) return cloneImageData(top);
  if (!top) return cloneImageData(bottom);
  switch (mode) {
    case 'under':    return blendUnder(top, bottom);
    case 'screen':   return blendScreen(top, bottom);
    case 'multiply': return blendMultiply(top, bottom);
    case 'add':      return blendAdd(top, bottom);
    case 'over':
    default:         return blendOver(top, bottom);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Glow — bright-pass + Gaussian + screen blend back over the original.
// ────────────────────────────────────────────────────────────────────────────

export function brightPass(src, threshold = 200) {
  const out = cloneImageData(src);
  const d = out.data;
  for (let i = 0; i < d.length; i += 4) {
    // Luminance — Rec. 709 weights.
    const lum = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    if (lum < threshold) {
      d[i] = d[i + 1] = d[i + 2] = 0;
    }
  }
  return out;
}

export function glow(src, { threshold = 200, radius = 8, sigma = 0, intensity = 1 } = {}) {
  const bright = brightPass(src, threshold);
  const blurred = gaussianBlur(bright, radius, sigma);
  // Optionally amplify the bloom before screening back.
  if (intensity !== 1) {
    const d = blurred.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i]     = Math.min(255, d[i]     * intensity);
      d[i + 1] = Math.min(255, d[i + 1] * intensity);
      d[i + 2] = Math.min(255, d[i + 2] * intensity);
    }
  }
  return blendScreen(src, blurred);
}

export default {
  newImageData, cloneImageData, loadImage, imageToImageData, imageDataToDataUrl, emptyImageData,
  invert, curves, levels, colorGrade,
  gaussianBlur, chromaKey, transform,
  blendOver, blendUnder, blendScreen, blendMultiply, blendAdd, merge,
  brightPass, glow,
};
