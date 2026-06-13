// ArchDisc Studio V3 — alpha brushes.
//
// An alpha is an N×N Float32 grayscale texture in the [0..1] range,
// generated procedurally so the bundle stays asset-free. The active
// alpha modulates every brush stroke: sample at the local UV across
// the brush footprint, multiply into the per-vertex falloff.
//
// 8 alphas:
//   1. circle      — radial Gauss falloff (the default)
//   2. square      — flat 1.0 inside, 0 outside; sharp boundary
//   3. star        — 5-point radial star
//   4. hatch       — diagonal stripes
//   5. dots        — regular polka-dot lattice
//   6. splatter    — pseudo-random radial speckles
//   7. ridges      — radial sine ridges (turbine fin look)
//   8. fingerprint — sin(radius) × small angular jitter
//
// `alphaSample(u, v)` reads the active alpha at fractional UVs in
// [0..1]; falls back to "no modulation" (returns 1) when no alpha
// is set. The brush patcher should default to weight=1 when this
// returns nothing.

const N = 64; // resolution; small enough to be free, large enough to look textured

const _alphas = new Map();
let _activeName = null;

function makeTex(fillFn) {
  const buf = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / (N - 1);
      const v = y / (N - 1);
      buf[y * N + x] = Math.min(1, Math.max(0, fillFn(u, v)));
    }
  }
  return { buf, n: N };
}

// 1. circle — Gauss falloff
function circle(u, v) {
  const dx = u - 0.5, dy = v - 0.5;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r > 0.5) return 0;
  return Math.exp(-(r * r) * 12);
}

// 2. square — flat in the center, sharp boundary
function square(u, v) {
  const dx = Math.abs(u - 0.5);
  const dy = Math.abs(v - 0.5);
  const m = Math.max(dx, dy);
  if (m > 0.45) return 0;
  return 1.0;
}

// 3. star — 5-point radial star
function star(u, v) {
  const dx = u - 0.5, dy = v - 0.5;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r > 0.5 || r < 0.05) return 0;
  const ang = Math.atan2(dy, dx);
  const k = 5;
  // distance to nearest tip — modulated cosine
  const t = 0.5 * (1 + Math.cos(k * ang));
  const innerR = 0.15 + 0.3 * t;
  if (r > innerR) return 0;
  return 1 - r / innerR;
}

// 4. hatch — diagonal stripes
function hatch(u, v) {
  const d = (u * 8 + v * 8) % 1;
  const stripe = d < 0.5 ? 1.0 : 0.0;
  // outer circle gate
  const dx = u - 0.5, dy = v - 0.5;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r > 0.5) return 0;
  return stripe * (1 - r);
}

// 5. dots — regular lattice
function dots(u, v) {
  const cells = 6;
  const cx = Math.floor(u * cells) + 0.5;
  const cy = Math.floor(v * cells) + 0.5;
  const lu = (u * cells) - cx;
  const lv = (v * cells) - cy;
  const r = Math.sqrt(lu * lu + lv * lv);
  // dot radius
  if (r > 0.3) return 0;
  // outer circle gate
  const dx = u - 0.5, dy = v - 0.5;
  const R = Math.sqrt(dx * dx + dy * dy);
  if (R > 0.5) return 0;
  return (1 - r / 0.3) * (1 - R / 0.5);
}

// 6. splatter — deterministic pseudo-random speckles (no seed needed —
// derived from grid coords, so it's reproducible across runs).
function splatter(u, v) {
  const dx = u - 0.5, dy = v - 0.5;
  const R = Math.sqrt(dx * dx + dy * dy);
  if (R > 0.5) return 0;
  // hash-ish pseudo-noise
  const h = Math.sin(u * 91.7 + v * 47.3) * 43758.5453;
  const n = h - Math.floor(h);
  if (n < 0.4) return 0;
  return (n - 0.4) / 0.6 * (1 - R / 0.5);
}

// 7. ridges — radial sine ridges
function ridges(u, v) {
  const dx = u - 0.5, dy = v - 0.5;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r > 0.5) return 0;
  const ang = Math.atan2(dy, dx);
  // 12 ridges
  const s = 0.5 + 0.5 * Math.cos(ang * 12);
  return s * (1 - r / 0.5);
}

// 8. fingerprint — concentric rings with slight angular jitter
function fingerprint(u, v) {
  const dx = u - 0.5, dy = v - 0.5;
  const r = Math.sqrt(dx * dx + dy * dy);
  if (r > 0.5) return 0;
  const ang = Math.atan2(dy, dx);
  const wobble = 0.04 * Math.sin(ang * 7);
  const rings = 0.5 + 0.5 * Math.sin((r + wobble) * 40);
  return rings * (1 - r / 0.5);
}

const SPEC = [
  ['circle',      circle],
  ['square',      square],
  ['star',        star],
  ['hatch',       hatch],
  ['dots',        dots],
  ['splatter',    splatter],
  ['ridges',      ridges],
  ['fingerprint', fingerprint],
];

function ensureBuilt() {
  if (_alphas.size === SPEC.length) return;
  for (const [name, fn] of SPEC) _alphas.set(name, makeTex(fn));
}

export function alphaList() {
  ensureBuilt();
  return {
    ok: true,
    count: _alphas.size,
    active: _activeName,
    resolution: N,
    alphas: Array.from(_alphas.keys()),
    custom: Array.from(_alphas.entries())
      .filter(([, e]) => e.custom).map(([k]) => k),
  };
}

export function alphaSet(name) {
  ensureBuilt();
  if (!name) {
    _activeName = null;
    return { ok: true, active: null };
  }
  if (!_alphas.has(name)) return { ok: false, error: 'no alpha' };
  _activeName = name;
  return { ok: true, active: _activeName };
}

export function alphaSample(u, v) {
  if (!_activeName) return { ok: true, weight: 1, active: null };
  ensureBuilt();
  const entry = _alphas.get(_activeName);
  if (!entry) return { ok: true, weight: 1, active: null };
  const { buf, n } = entry;
  // tile UVs into [0..1]
  let uu = u - Math.floor(u);
  let vv = v - Math.floor(v);
  // bilinear sample at the alpha's own resolution
  const xf = uu * (n - 1);
  const yf = vv * (n - 1);
  const x0 = Math.floor(xf), y0 = Math.floor(yf);
  const x1 = Math.min(n - 1, x0 + 1);
  const y1 = Math.min(n - 1, y0 + 1);
  const fx = xf - x0, fy = yf - y0;
  const a = buf[y0 * n + x0];
  const b = buf[y0 * n + x1];
  const c = buf[y1 * n + x0];
  const d = buf[y1 * n + x1];
  const w = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  return { ok: true, weight: w, active: _activeName };
}

// Internal: raw weight (number) for use by the brush patcher.
export function alphaWeightAt(u, v) {
  if (!_activeName) return 1;
  return alphaSample(u, v).weight;
}

// Internal: expose the active alpha buffer (read-only). Useful for
// HUD previews / tests.
export function alphaGetActiveBuffer() {
  if (!_activeName) return null;
  ensureBuilt();
  const entry = _alphas.get(_activeName);
  return entry ? entry.buf : null;
}

export const ALPHA_RES = N;

// ─── Slice 959 — custom alpha-image stencils (ZBrush parity) ─────────────
//
// Load ANY grayscale image as a brush alpha: a data URL, an
// HTMLImageElement / ImageBitmap / canvas, or raw {data,width,height}
// RGBA pixels. Luminance (Rec. 709) becomes the brush weight. Custom
// alphas live in the same registry as the 8 procedural ones, so
// alphaSet / alphaSample / the brush patcher need no changes.

const CUSTOM_RES = 128; // resample target for image stencils

function bufFromImageData(data, width, height) {
  const out = new Float32Array(CUSTOM_RES * CUSTOM_RES);
  for (let y = 0; y < CUSTOM_RES; y++) {
    for (let x = 0; x < CUSTOM_RES; x++) {
      // nearest-source sample; CUSTOM_RES is dense enough that the
      // bilinear read in alphaSample smooths the rest.
      const sx = Math.min(width - 1, Math.round((x / (CUSTOM_RES - 1)) * (width - 1)));
      const sy = Math.min(height - 1, Math.round((y / (CUSTOM_RES - 1)) * (height - 1)));
      const i = (sy * width + sx) * 4;
      const lum = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
      const a = data[i + 3] / 255;
      out[y * CUSTOM_RES + x] = Math.min(1, Math.max(0, lum * a));
    }
  }
  return out;
}

async function decodeToImageData(source) {
  if (source && typeof source === 'object'
      && source.data && Number.isFinite(source.width) && Number.isFinite(source.height)) {
    return source; // already RGBA pixels
  }
  let drawable = source;
  if (typeof source === 'string') {
    drawable = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('alpha image failed to decode'));
      img.src = source;
    });
  }
  const w = drawable.naturalWidth || drawable.videoWidth || drawable.width;
  const h = drawable.naturalHeight || drawable.videoHeight || drawable.height;
  if (!w || !h) throw new Error('alpha image has no dimensions');
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(drawable, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

export async function alphaLoadImage(name, source) {
  ensureBuilt();
  if (!name || typeof name !== 'string') return { ok: false, error: 'name required' };
  if (SPEC.some(([n]) => n === name)) {
    return { ok: false, error: `"${name}" is a built-in alpha — pick another name` };
  }
  if (source == null) return { ok: false, error: 'image source required' };
  const img = await decodeToImageData(source);
  const buf = bufFromImageData(img.data, img.width, img.height);
  // A stencil that is all-zero (or all-one) modulates nothing — that is
  // an authoring mistake the sculptor should hear about, not discover
  // three strokes later.
  let mn = 1, mx = 0;
  for (let i = 0; i < buf.length; i++) { if (buf[i] < mn) mn = buf[i]; if (buf[i] > mx) mx = buf[i]; }
  if (mx - mn < 1e-4) {
    return { ok: false, error: 'alpha image is uniform — no usable stencil contrast' };
  }
  _alphas.set(name, { buf, n: CUSTOM_RES, custom: true });
  _activeName = name;
  return { ok: true, name, active: name, resolution: CUSTOM_RES, sourceSize: [img.width, img.height] };
}

export function alphaDeleteCustom(name) {
  ensureBuilt();
  const entry = _alphas.get(name);
  if (!entry) return { ok: false, error: 'no alpha' };
  if (!entry.custom) return { ok: false, error: 'built-in alphas cannot be deleted' };
  _alphas.delete(name);
  if (_activeName === name) _activeName = null;
  return { ok: true, deleted: name };
}
