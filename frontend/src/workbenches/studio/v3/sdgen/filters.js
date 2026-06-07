// ArchDisc Studio V3 — Substance Designer image filters (slice 775).
//
// 8 pure-JS image filters that consume and return Float32Array (size × size,
// luminance). Filters are designed to be stacked on top of any generator
// output from generators.js. NO Math.random anywhere; any internal random
// taps (warp) go through mulberry32 via the shared common/random.js.
//
// Filters:
//   blur     — 3×3 box blur, iterable via passes
//   sharpen  — Laplacian unsharp-mask (centre minus neighbours, scaled)
//   levels   — input/output remap with gamma midpoint
//   curves   — piecewise-linear (cubic Catmull-Rom optional) spline
//   hsv      — hue-shift on a luminance source: maps shift→colour-band
//   tile     — repeat the source as an N×M grid (sub-sampled lookup)
//   mirror   — reflect across centre on chosen axis ('x' / 'y' / 'both')
//   warp     — noise-displaced lookup; offset taps via low-freq value noise
//
// Buffer layout: row-major, indexed `i = y * size + x`. Filters that need
// a second channel (hsv) emit RGB by widening to a stride-3 Float32Array.

import { mulberry32 } from '../common/random.js';

function _alloc(n) { return new Float32Array(n); }
function _clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function _idx(x, y, size) {
  if (x < 0) x = 0; else if (x >= size) x = size - 1;
  if (y < 0) y = 0; else if (y >= size) y = size - 1;
  return y * size + x;
}

function _size(buf) {
  const n = Math.round(Math.sqrt(buf.length));
  return n * n === buf.length ? n : 0;
}

// ─── 1) Blur ──────────────────────────────────────────────────────────────
// Iterated 3×3 box blur. params.passes ∈ [1, 8]. Edges clamp.
export function blur(buf, params) {
  const size = _size(buf);
  if (!size) return new Float32Array(buf);
  const passes = Math.max(1, Math.min(8, Number(params?.passes) || 1));
  let src = new Float32Array(buf);
  let dst = new Float32Array(buf.length);
  for (let pass = 0; pass < passes; pass++) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let s = 0;
        for (let oy = -1; oy <= 1; oy++) {
          for (let ox = -1; ox <= 1; ox++) {
            s += src[_idx(x + ox, y + oy, size)];
          }
        }
        dst[y * size + x] = s / 9;
      }
    }
    // Ping-pong.
    const t = src; src = dst; dst = t;
  }
  return src;
}

// ─── 2) Sharpen ───────────────────────────────────────────────────────────
// Laplacian unsharp mask: out = src + amount * (src − avg9). Clamped.
export function sharpen(buf, params) {
  const size = _size(buf);
  if (!size) return new Float32Array(buf);
  const amount = Math.max(0, Math.min(8, Number(params?.amount) || 1));
  const out = new Float32Array(buf.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let s = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          s += buf[_idx(x + ox, y + oy, size)];
        }
      }
      const avg = s / 9;
      const c = buf[y * size + x];
      out[y * size + x] = _clamp01(c + amount * (c - avg));
    }
  }
  return out;
}

// ─── 3) Levels ────────────────────────────────────────────────────────────
// Per-pixel remap: black/white input cap + gamma midpoint, then output cap.
// Defaults reproduce the identity transform.
export function levels(buf, params) {
  const inLo = Math.max(0, Math.min(1, Number(params?.inLo ?? 0)));
  const inHi = Math.max(0, Math.min(1, Number(params?.inHi ?? 1)));
  const outLo = Math.max(0, Math.min(1, Number(params?.outLo ?? 0)));
  const outHi = Math.max(0, Math.min(1, Number(params?.outHi ?? 1)));
  const gamma = Math.max(0.05, Math.min(20, Number(params?.gamma ?? 1)));
  const span = (inHi - inLo) || 1e-6;
  const invG = 1 / gamma;
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    let t = (buf[i] - inLo) / span;
    t = _clamp01(t);
    t = Math.pow(t, invG);
    out[i] = _clamp01(outLo + t * (outHi - outLo));
  }
  return out;
}

// ─── 4) Curves ────────────────────────────────────────────────────────────
// Piecewise-linear spline over an arbitrary number of control points.
// params.points = [[x0,y0],[x1,y1],…] sorted by x ∈ [0, 1].
// Default points = [[0,0],[1,1]] (identity).
export function curves(buf, params) {
  let pts = Array.isArray(params?.points) && params.points.length >= 2
    ? params.points.map((p) => [Number(p[0]) || 0, Number(p[1]) || 0])
    : [[0, 0], [1, 1]];
  pts = pts.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  pts.sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) pts = [[0, 0], [1, 1]];
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const x = _clamp01(buf[i]);
    let y;
    if (x <= pts[0][0]) y = pts[0][1];
    else if (x >= pts[pts.length - 1][0]) y = pts[pts.length - 1][1];
    else {
      // Find the bracketing segment.
      let k = 0;
      while (k < pts.length - 1 && x > pts[k + 1][0]) k++;
      const [x0, y0] = pts[k];
      const [x1, y1] = pts[k + 1];
      const t = (x - x0) / (x1 - x0 || 1e-6);
      y = y0 + (y1 - y0) * t;
    }
    out[i] = _clamp01(y);
  }
  return out;
}

// ─── 5) HSV ──────────────────────────────────────────────────────────────
// Treat the input scalar as a luminance and emit an RGB buffer with an
// HSV transform applied. params.shift rotates hue [0, 1); params.sat
// scales saturation; params.val scales value. Returns Float32Array of
// length 3 * size * size laid out (r, g, b) per pixel.
function _hsv2rgb(h, s, v) {
  const c = v * s;
  const hh = (h % 1 + 1) % 1 * 6;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hh < 1) { r = c; g = x; }
  else if (hh < 2) { r = x; g = c; }
  else if (hh < 3) { g = c; b = x; }
  else if (hh < 4) { g = x; b = c; }
  else if (hh < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = v - c;
  return [r + m, g + m, b + m];
}
export function hsv(buf, params) {
  const shift = Number(params?.shift) || 0;
  const sat = Math.max(0, Math.min(2, Number(params?.sat ?? 1)));
  const val = Math.max(0, Math.min(2, Number(params?.val ?? 1)));
  // Output keeps the same buffer length (one channel) — caller uses
  // ExportCanvasTexture to spread to RGB. We pack RGB into a wider buffer
  // when params.rgb === true.
  if (params?.rgb) {
    const out = new Float32Array(buf.length * 3);
    for (let i = 0; i < buf.length; i++) {
      const v0 = _clamp01(buf[i]);
      // Derive hue from input scalar so colour bands appear; saturation
      // tied to input contrast for richer outputs.
      const h = (v0 + shift) % 1;
      const rgb = _hsv2rgb(h, sat, _clamp01(v0 * val));
      out[i * 3] = rgb[0];
      out[i * 3 + 1] = rgb[1];
      out[i * 3 + 2] = rgb[2];
    }
    return out;
  }
  // Scalar pass-through: hue shift influences output via brightness modulo.
  const out = new Float32Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const v0 = _clamp01(buf[i]);
    const h = (v0 + shift) % 1;
    const rgb = _hsv2rgb(h, sat, _clamp01(v0 * val));
    out[i] = _clamp01((rgb[0] + rgb[1] + rgb[2]) / 3);
  }
  return out;
}

// ─── 6) Tile (repeat N × M) ──────────────────────────────────────────────
// Resample the source as an N × M grid of copies. Wraps both axes.
export function tile(buf, params) {
  const size = _size(buf);
  if (!size) return new Float32Array(buf);
  const tilesX = Math.max(1, Math.min(16, Number(params?.tilesX) || 2));
  const tilesY = Math.max(1, Math.min(16, Number(params?.tilesY) || 2));
  const out = new Float32Array(buf.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = (x * tilesX) % size;
      const sy = (y * tilesY) % size;
      out[y * size + x] = buf[Math.floor(sy) * size + Math.floor(sx)];
    }
  }
  return out;
}

// ─── 7) Mirror ────────────────────────────────────────────────────────────
// Reflect across the centre of the chosen axis. axis: 'x' | 'y' | 'both'.
export function mirror(buf, params) {
  const size = _size(buf);
  if (!size) return new Float32Array(buf);
  const axis = params?.axis || 'x';
  const out = new Float32Array(buf.length);
  const half = size >> 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let sx = x, sy = y;
      if (axis === 'x' || axis === 'both') {
        sx = x < half ? x : size - 1 - x;
      }
      if (axis === 'y' || axis === 'both') {
        sy = y < half ? y : size - 1 - y;
      }
      out[y * size + x] = buf[sy * size + sx];
    }
  }
  return out;
}

// ─── 8) Warp (noise-displaced lookup) ────────────────────────────────────
// Build a small low-freq value-noise field, then for each output pixel
// sample the source at (x + nx*amount, y + ny*amount). Edges clamp.
export function warp(buf, params) {
  const size = _size(buf);
  if (!size) return new Float32Array(buf);
  const amount = Math.max(0, Math.min(size / 2, Number(params?.amount) || size * 0.06));
  const scale = Math.max(1, Math.min(64, Number(params?.scale) || 8));
  const seed = (Number(params?.seed) | 0) || 41;
  const rng = mulberry32(seed);
  // Build a low-freq grid (scale+1) × (scale+1) of random offsets.
  const grid = scale + 1;
  const gx = new Float32Array(grid * grid);
  const gy = new Float32Array(grid * grid);
  for (let i = 0; i < gx.length; i++) { gx[i] = rng() * 2 - 1; gy[i] = rng() * 2 - 1; }
  function _smoothstep(t) { return t * t * (3 - 2 * t); }
  function _sampleVec(u, v) {
    const x = u * scale;
    const y = v * scale;
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const fx = _smoothstep(x - x0), fy = _smoothstep(y - y0);
    const a = y0 * grid + x0;
    const b = y0 * grid + Math.min(scale, x0 + 1);
    const c = Math.min(scale, y0 + 1) * grid + x0;
    const d = Math.min(scale, y0 + 1) * grid + Math.min(scale, x0 + 1);
    const ix0x = gx[a] + (gx[b] - gx[a]) * fx;
    const ix1x = gx[c] + (gx[d] - gx[c]) * fx;
    const ix0y = gy[a] + (gy[b] - gy[a]) * fx;
    const ix1y = gy[c] + (gy[d] - gy[c]) * fx;
    return [ix0x + (ix1x - ix0x) * fy, ix0y + (ix1y - ix0y) * fy];
  }
  const out = new Float32Array(buf.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const off = _sampleVec(u, v);
      const sx = Math.round(x + off[0] * amount);
      const sy = Math.round(y + off[1] * amount);
      out[y * size + x] = buf[_idx(sx, sy, size)];
    }
  }
  return out;
}

// Canonical (insertion-ordered) name → fn map.
export const FILTERS = {
  blur, sharpen, levels, curves, hsv, tile, mirror, warp,
};

export const FILTER_NAMES = Object.keys(FILTERS);
