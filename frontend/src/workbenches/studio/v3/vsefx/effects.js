// ArchDisc Studio V3 — VSE FX effect strips.
//
// Six single-input image effects, each implemented as a pure pixel
// kernel over an RGBA Uint8ClampedArray.
//
//   1. Glow                — bright-pass + small blur + add back.
//   2. MotionBlur          — 1-D directional blur (angle/distance).
//   3. ChromaticAberration — per-channel pixel offset (R left, B right).
//   4. Pixelate            — N×N block average.
//   5. Vignette            — radial darkening from corners.
//   6. GammaShift          — per-pixel pow(channel, gamma).
//
// Each kernel returns a fresh ImageData. Inputs are never mutated.

const _EFFECTS = new Map();

function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function clampByte(v) { return v < 0 ? 0 : v > 255 ? 255 : v | 0; }

function checkInput(a) {
  if (!a) throw new Error('VSEFX effect: missing input frame');
  if (typeof a.width !== 'number' || typeof a.height !== 'number') {
    throw new Error('VSEFX effect: input must be ImageData-like { width, height, data }');
  }
  if (!a.data) throw new Error('VSEFX effect: missing pixel data');
}

function makeOut(w, h) {
  if (typeof ImageData !== 'undefined') {
    try { return new ImageData(w, h); } catch (_) { /* fall through */ }
  }
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

// Copy a→out so a kernel that only writes a subset still produces a
// fully-populated frame.
function copyAll(src, dst) {
  const sd = src.data, dd = dst.data;
  for (let i = 0; i < sd.length; i += 1) dd[i] = sd[i];
}

// ─── Kernels ────────────────────────────────────────────────────────

function Glow(a, params) {
  checkInput(a);
  const w = a.width, h = a.height;
  const out = makeOut(w, h);
  const ad = a.data, od = out.data;
  const threshold = clamp01(+params?.threshold !== undefined ? +params.threshold : 0.6);
  const intensity = +params?.intensity !== undefined ? +params.intensity : 0.6;
  const radius = Math.max(1, Math.min(8, Math.floor(+params?.radius || 2)));

  // 1. Bright-pass into a temp buffer.
  const bright = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < ad.length; i += 4) {
    const r = ad[i] / 255, g = ad[i + 1] / 255, b = ad[i + 2] / 255;
    // Rec. 709 luma.
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum > threshold) {
      const s = (lum - threshold) / (1 - threshold);
      bright[i]     = clampByte(ad[i] * s);
      bright[i + 1] = clampByte(ad[i + 1] * s);
      bright[i + 2] = clampByte(ad[i + 2] * s);
      bright[i + 3] = 255;
    } else {
      bright[i] = bright[i + 1] = bright[i + 2] = 0;
      bright[i + 3] = 0;
    }
  }

  // 2. Separable box blur on the bright-pass.
  const blurred = boxBlur(bright, w, h, radius);

  // 3. Add the blurred bright pixels back to the original.
  for (let i = 0; i < ad.length; i += 4) {
    od[i]     = clampByte(ad[i]     + blurred[i]     * intensity);
    od[i + 1] = clampByte(ad[i + 1] + blurred[i + 1] * intensity);
    od[i + 2] = clampByte(ad[i + 2] + blurred[i + 2] * intensity);
    od[i + 3] = ad[i + 3];
  }
  return out;
}

// Tiny 2-pass separable box blur over a Uint8ClampedArray.
function boxBlur(src, w, h, radius) {
  const r = Math.max(0, Math.floor(radius) | 0);
  if (r === 0) return src;
  const window = r * 2 + 1;
  const inv = 1 / window;
  const tmp = new Uint8ClampedArray(w * h * 4);
  // Horizontal pass: src → tmp.
  for (let y = 0; y < h; y += 1) {
    let rs = 0, gs = 0, bs = 0, as = 0;
    // Prime the running sum across the leftmost window, clamping at
    // the edge so out-of-bounds samples reuse column 0.
    for (let k = -r; k <= r; k += 1) {
      const x = k < 0 ? 0 : (k >= w ? w - 1 : k);
      const i = (y * w + x) * 4;
      rs += src[i]; gs += src[i + 1]; bs += src[i + 2]; as += src[i + 3];
    }
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      tmp[o]     = (rs * inv) | 0;
      tmp[o + 1] = (gs * inv) | 0;
      tmp[o + 2] = (bs * inv) | 0;
      tmp[o + 3] = (as * inv) | 0;
      // Slide the window: subtract leaving column, add entering one.
      const xOut = x - r;
      const xIn  = x + r + 1;
      const ox = xOut < 0 ? 0 : (xOut >= w ? w - 1 : xOut);
      const ix = xIn  < 0 ? 0 : (xIn  >= w ? w - 1 : xIn);
      const oI = (y * w + ox) * 4;
      const iI = (y * w + ix) * 4;
      rs += src[iI]     - src[oI];
      gs += src[iI + 1] - src[oI + 1];
      bs += src[iI + 2] - src[oI + 2];
      as += src[iI + 3] - src[oI + 3];
    }
  }
  // Vertical pass: tmp → out.
  const out = new Uint8ClampedArray(w * h * 4);
  for (let x = 0; x < w; x += 1) {
    let rs = 0, gs = 0, bs = 0, as = 0;
    for (let k = -r; k <= r; k += 1) {
      const y = k < 0 ? 0 : (k >= h ? h - 1 : k);
      const i = (y * w + x) * 4;
      rs += tmp[i]; gs += tmp[i + 1]; bs += tmp[i + 2]; as += tmp[i + 3];
    }
    for (let y = 0; y < h; y += 1) {
      const o = (y * w + x) * 4;
      out[o]     = (rs * inv) | 0;
      out[o + 1] = (gs * inv) | 0;
      out[o + 2] = (bs * inv) | 0;
      out[o + 3] = (as * inv) | 0;
      const yOut = y - r;
      const yIn  = y + r + 1;
      const oy = yOut < 0 ? 0 : (yOut >= h ? h - 1 : yOut);
      const iy = yIn  < 0 ? 0 : (yIn  >= h ? h - 1 : yIn);
      const oI = (oy * w + x) * 4;
      const iI = (iy * w + x) * 4;
      rs += tmp[iI]     - tmp[oI];
      gs += tmp[iI + 1] - tmp[oI + 1];
      bs += tmp[iI + 2] - tmp[oI + 2];
      as += tmp[iI + 3] - tmp[oI + 3];
    }
  }
  return out;
}

function MotionBlur(a, params) {
  checkInput(a);
  const w = a.width, h = a.height;
  const out = makeOut(w, h);
  const ad = a.data, od = out.data;
  const angleDeg = +params?.angle !== undefined ? +params.angle : 0;
  const distance = Math.max(1, Math.min(64, Math.floor(+params?.distance || 8)));
  const samples = distance * 2 + 1;
  const rad = (angleDeg * Math.PI) / 180;
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let rs = 0, gs = 0, bs = 0, as = 0;
      for (let k = -distance; k <= distance; k += 1) {
        const sx = Math.round(x + ux * k);
        const sy = Math.round(y + uy * k);
        const cx = sx < 0 ? 0 : (sx >= w ? w - 1 : sx);
        const cy = sy < 0 ? 0 : (sy >= h ? h - 1 : sy);
        const i = (cy * w + cx) * 4;
        rs += ad[i]; gs += ad[i + 1]; bs += ad[i + 2]; as += ad[i + 3];
      }
      const o = (y * w + x) * 4;
      od[o]     = (rs / samples) | 0;
      od[o + 1] = (gs / samples) | 0;
      od[o + 2] = (bs / samples) | 0;
      od[o + 3] = (as / samples) | 0;
    }
  }
  return out;
}

function ChromaticAberration(a, params) {
  checkInput(a);
  const w = a.width, h = a.height;
  const out = makeOut(w, h);
  const ad = a.data, od = out.data;
  const shift = Math.max(1, Math.min(32, Math.floor(+params?.shift || 4)));
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const o = (y * w + x) * 4;
      // Red sampled to the left
      const rx = x - shift; const rcx = rx < 0 ? 0 : (rx >= w ? w - 1 : rx);
      // Green stays
      // Blue sampled to the right
      const bx = x + shift; const bcx = bx < 0 ? 0 : (bx >= w ? w - 1 : bx);
      const ri = (y * w + rcx) * 4;
      const bi = (y * w + bcx) * 4;
      od[o]     = ad[ri];
      od[o + 1] = ad[o + 1];   // green unchanged from input
      od[o + 2] = ad[bi + 2];
      od[o + 3] = ad[o + 3];
    }
  }
  return out;
}

function Pixelate(a, params) {
  checkInput(a);
  const w = a.width, h = a.height;
  const out = makeOut(w, h);
  const ad = a.data, od = out.data;
  const N = Math.max(2, Math.min(64, Math.floor(+params?.size || 8)));
  for (let by = 0; by < h; by += N) {
    for (let bx = 0; bx < w; bx += N) {
      // Block average.
      let rs = 0, gs = 0, bs = 0, as = 0, count = 0;
      const yEnd = Math.min(h, by + N);
      const xEnd = Math.min(w, bx + N);
      for (let y = by; y < yEnd; y += 1) {
        for (let x = bx; x < xEnd; x += 1) {
          const i = (y * w + x) * 4;
          rs += ad[i]; gs += ad[i + 1]; bs += ad[i + 2]; as += ad[i + 3];
          count += 1;
        }
      }
      const r = (rs / count) | 0;
      const g = (gs / count) | 0;
      const b = (bs / count) | 0;
      const al = (as / count) | 0;
      for (let y = by; y < yEnd; y += 1) {
        for (let x = bx; x < xEnd; x += 1) {
          const o = (y * w + x) * 4;
          od[o] = r; od[o + 1] = g; od[o + 2] = b; od[o + 3] = al;
        }
      }
    }
  }
  return out;
}

function Vignette(a, params) {
  checkInput(a);
  const w = a.width, h = a.height;
  const out = makeOut(w, h);
  const ad = a.data, od = out.data;
  const strength = Math.max(0, Math.min(1, +params?.strength !== undefined ? +params.strength : 0.6));
  const softness = Math.max(0.01, Math.min(2, +params?.softness !== undefined ? +params.softness : 1.0));
  const cx = (w - 1) * 0.5;
  const cy = (h - 1) * 0.5;
  const maxR = Math.hypot(cx, cy);
  for (let y = 0; y < h; y += 1) {
    const dy = y - cy;
    for (let x = 0; x < w; x += 1) {
      const dx = x - cx;
      const d = Math.hypot(dx, dy) / maxR;     // [0,1]
      // raise to `softness` so larger softness pushes the dark band further out
      const dim = 1 - strength * Math.pow(d, 2 / softness);
      const o = (y * w + x) * 4;
      od[o]     = clampByte(ad[o]     * dim);
      od[o + 1] = clampByte(ad[o + 1] * dim);
      od[o + 2] = clampByte(ad[o + 2] * dim);
      od[o + 3] = ad[o + 3];
    }
  }
  return out;
}

function GammaShift(a, params) {
  checkInput(a);
  const w = a.width, h = a.height;
  const out = makeOut(w, h);
  const ad = a.data, od = out.data;
  const gamma = Math.max(0.05, +params?.gamma || 1.0);
  const invG = 1 / gamma;
  // LUT for speed — pow on every sample over a million pixels is the
  // sort of thing that drops a Mac Studio's frame budget on the floor.
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v += 1) {
    const norm = v / 255;
    const out8 = Math.round(Math.pow(norm, invG) * 255);
    lut[v] = clampByte(out8);
  }
  for (let i = 0; i < ad.length; i += 4) {
    od[i]     = lut[ad[i]];
    od[i + 1] = lut[ad[i + 1]];
    od[i + 2] = lut[ad[i + 2]];
    od[i + 3] = ad[i + 3];
  }
  return out;
}

// ─── Registry ───────────────────────────────────────────────────────

const KINDS = [
  { kind: 'Glow',                fn: Glow,
    description: 'Bright-pass + blur + add-back glow.' },
  { kind: 'MotionBlur',          fn: MotionBlur,
    description: 'Directional 1-D motion blur (params: angle, distance).' },
  { kind: 'ChromaticAberration', fn: ChromaticAberration,
    description: 'Per-channel offset (R left, B right; param: shift).' },
  { kind: 'Pixelate',            fn: Pixelate,
    description: 'Block-average to N×N pixels (param: size).' },
  { kind: 'Vignette',            fn: Vignette,
    description: 'Radial darkening (params: strength, softness).' },
  { kind: 'GammaShift',          fn: GammaShift,
    description: 'Per-pixel pow(channel, gamma).' },
];

for (const k of KINDS) _EFFECTS.set(k.kind, k);

function tryRegisterWithVSE() {
  if (typeof window === 'undefined') return false;
  const reg = window.__studioVSERegisterEffect;
  if (typeof reg !== 'function') return false;
  let n = 0;
  for (const k of KINDS) {
    try { reg(k.kind, k.fn); n += 1; } catch (_) { /* keep going */ }
  }
  return n > 0;
}

// ─── Public API ─────────────────────────────────────────────────────

export function listEffects() {
  return Array.from(_EFFECTS.keys());
}

export function getEffect(kind) {
  const k = _EFFECTS.get(String(kind || ''));
  return k ? k.fn : null;
}

export function applyEffect(kind, a, params) {
  const fn = getEffect(kind);
  if (!fn) throw new Error(`VSEFX: unknown effect kind "${kind}"`);
  return fn(a, params || {});
}

export function installWindowHook() {
  if (typeof window === 'undefined') return false;
  window.__studioVSEFXApplyOne = (kind, a, params) =>
    applyEffect(kind, a, params || {});
  tryRegisterWithVSE();
  return true;
}

export default {
  list: listEffects,
  get: getEffect,
  apply: applyEffect,
  installWindowHook,
};
