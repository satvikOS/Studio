// ArchDisc Studio V3 — VSE FX transitions.
//
// Six Blender-VSE-style transitions, each implemented as a pure
// per-pixel kernel over two RGBA Uint8ClampedArrays of identical
// dimensions, parameterised by t ∈ [0, 1].
//
//   1. CrossFade   — straight linear blend.
//   2. Wipe        — left half from a, right from b; t controls boundary.
//   3. Slide       — b slides in from a chosen side (left/right/up/down).
//   4. Dissolve    — random per-pixel threshold against t.
//   5. Iris        — circular reveal of b over a, centred on the canvas.
//   6. PushZoom    — a scales out while b scales in.
//
// Each kernel returns a fresh ImageData; callers may discard the
// inputs. We avoid allocating per-pixel objects — the entire body of
// every kernel is a single tight u8 loop.
//
// We optionally register every kind with the slice-690 VSE engine if
// it exposes a registry; otherwise we maintain our own local registry
// so callers can list / dispatch transitions identically.

const _TRANSITIONS = new Map();   // kind → { name, fn, params: [{key, default, type}] }

// ─── Utility ────────────────────────────────────────────────────────

// Deterministic-ish hash for the Dissolve kernel. Stays inline for
// speed; the goal is reproducibility per-pixel-coord so the dissolve
// pattern doesn't crawl while t advances.
function hash2(x, y) {
  // Wang-style integer hash, 32-bit truncated.
  let h = (x * 0x27d4eb2d) ^ (y * 0x165667b1);
  h = (h ^ (h >>> 15)) >>> 0;
  h = (h * 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = (h * 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h & 0xffffff) / 0xffffff;       // [0,1)
}

function clampT(t) {
  const n = +t;
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function checkPair(a, b) {
  if (!a || !b) throw new Error('VSEFX transition: missing input frames');
  if (typeof a.width !== 'number' || typeof a.height !== 'number'
   || typeof b.width !== 'number' || typeof b.height !== 'number') {
    throw new Error('VSEFX transition: inputs must be ImageData-like { width, height, data }');
  }
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`VSEFX transition: size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  if (!a.data || !b.data) throw new Error('VSEFX transition: missing pixel data');
}

// Allocate a fresh ImageData-shaped object that works in browsers + tests.
function makeOut(w, h) {
  // Prefer a real ImageData when DOM is present so consumers can
  // putImageData() directly. Fall back to a plain object otherwise.
  if (typeof ImageData !== 'undefined') {
    try { return new ImageData(w, h); }
    catch (_) { /* SAB issues in some envs — fall through. */ }
  }
  return { width: w, height: h, data: new Uint8ClampedArray(w * h * 4) };
}

function sideToDir(side) {
  const s = String(side || '').toLowerCase();
  if (s === 'right') return { dx: +1, dy:  0 };
  if (s === 'up')    return { dx:  0, dy: -1 };
  if (s === 'down')  return { dx:  0, dy: +1 };
  return                    { dx: -1, dy:  0 };   // 'left' default
}

// ─── Kernels ────────────────────────────────────────────────────────

function CrossFade(a, b, t, _params) {
  checkPair(a, b);
  const w = a.width, h = a.height;
  const out = makeOut(w, h);
  const ad = a.data, bd = b.data, od = out.data;
  const tt = clampT(t);
  const inv = 1 - tt;
  for (let i = 0; i < ad.length; i += 4) {
    od[i]     = ad[i]     * inv + bd[i]     * tt;
    od[i + 1] = ad[i + 1] * inv + bd[i + 1] * tt;
    od[i + 2] = ad[i + 2] * inv + bd[i + 2] * tt;
    od[i + 3] = ad[i + 3] * inv + bd[i + 3] * tt;
  }
  return out;
}

function Wipe(a, b, t, params) {
  checkPair(a, b);
  const tt = clampT(t);
  const w = a.width, h = a.height;
  const out = makeOut(w, h);
  const ad = a.data, bd = b.data, od = out.data;
  // The wipe boundary advances across [0,w] linearly with t. Pixels
  // strictly left of the boundary come from `a`, the rest from `b`.
  // A small smoothing band (~2 px) feathers the edge so the seam
  // isn't a hard pixel step.
  const horizontal = String(params?.direction || 'horizontal').toLowerCase() !== 'vertical';
  const featherPx = Math.max(0, Math.min(8, +params?.feather || 2));
  if (horizontal) {
    const boundary = tt * w;
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        const d = x - boundary;
        let bw = 0;
        if (d < -featherPx) bw = 0;
        else if (d > featherPx) bw = 1;
        else bw = featherPx > 0 ? (d + featherPx) / (featherPx * 2) : (d >= 0 ? 1 : 0);
        const aw = 1 - bw;
        od[i]     = ad[i]     * aw + bd[i]     * bw;
        od[i + 1] = ad[i + 1] * aw + bd[i + 1] * bw;
        od[i + 2] = ad[i + 2] * aw + bd[i + 2] * bw;
        od[i + 3] = ad[i + 3] * aw + bd[i + 3] * bw;
      }
    }
  } else {
    const boundary = tt * h;
    for (let y = 0; y < h; y += 1) {
      const d = y - boundary;
      let bw = 0;
      if (d < -featherPx) bw = 0;
      else if (d > featherPx) bw = 1;
      else bw = featherPx > 0 ? (d + featherPx) / (featherPx * 2) : (d >= 0 ? 1 : 0);
      const aw = 1 - bw;
      for (let x = 0; x < w; x += 1) {
        const i = (y * w + x) * 4;
        od[i]     = ad[i]     * aw + bd[i]     * bw;
        od[i + 1] = ad[i + 1] * aw + bd[i + 1] * bw;
        od[i + 2] = ad[i + 2] * aw + bd[i + 2] * bw;
        od[i + 3] = ad[i + 3] * aw + bd[i + 3] * bw;
      }
    }
  }
  return out;
}

function Slide(a, b, t, params) {
  checkPair(a, b);
  const tt = clampT(t);
  const w = a.width, h = a.height;
  const out = makeOut(w, h);
  const ad = a.data, bd = b.data, od = out.data;
  const { dx, dy } = sideToDir(params?.side);
  // b enters from the chosen side; its top-left offset starts at the
  // opposite edge and travels toward (0,0) as t → 1.
  const offX = Math.round(dx * (1 - tt) * w);
  const offY = Math.round(dy * (1 - tt) * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      // Reverse-map (x,y) into b's coords by subtracting the offset
      // of b's top-left corner. If the source coord is in-bounds, we
      // take b; else we keep a.
      const bx = x - offX;
      const by = y - offY;
      if (bx >= 0 && bx < w && by >= 0 && by < h) {
        const j = (by * w + bx) * 4;
        od[i]     = bd[j];
        od[i + 1] = bd[j + 1];
        od[i + 2] = bd[j + 2];
        od[i + 3] = bd[j + 3];
      } else {
        od[i]     = ad[i];
        od[i + 1] = ad[i + 1];
        od[i + 2] = ad[i + 2];
        od[i + 3] = ad[i + 3];
      }
    }
  }
  return out;
}

function Dissolve(a, b, t, _params) {
  checkPair(a, b);
  const tt = clampT(t);
  const w = a.width, h = a.height;
  const out = makeOut(w, h);
  const ad = a.data, bd = b.data, od = out.data;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const r = hash2(x, y);
      if (r < tt) {
        od[i]     = bd[i];
        od[i + 1] = bd[i + 1];
        od[i + 2] = bd[i + 2];
        od[i + 3] = bd[i + 3];
      } else {
        od[i]     = ad[i];
        od[i + 1] = ad[i + 1];
        od[i + 2] = ad[i + 2];
        od[i + 3] = ad[i + 3];
      }
    }
  }
  return out;
}

function Iris(a, b, t, params) {
  checkPair(a, b);
  const tt = clampT(t);
  const w = a.width, h = a.height;
  const out = makeOut(w, h);
  const ad = a.data, bd = b.data, od = out.data;
  const cx = (w - 1) * 0.5;
  const cy = (h - 1) * 0.5;
  const maxR = Math.hypot(cx, cy);
  const r = tt * maxR;
  const r2 = r * r;
  // Soft edge: feather a couple of pixels around the radius so the
  // circle doesn't alias horribly at small sizes.
  const feather = Math.max(1, Math.min(8, +params?.feather || 2));
  const inner = Math.max(0, r - feather);
  const outer = r + feather;
  const inner2 = inner * inner;
  const outer2 = outer * outer;
  for (let y = 0; y < h; y += 1) {
    const dy = y - cy;
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const dx = x - cx;
      const d2 = dx * dx + dy * dy;
      let bw;
      if (d2 <= inner2) bw = 1;
      else if (d2 >= outer2) bw = 0;
      else {
        const d = Math.sqrt(d2);
        bw = 1 - (d - inner) / (outer - inner);
      }
      const aw = 1 - bw;
      od[i]     = ad[i]     * aw + bd[i]     * bw;
      od[i + 1] = ad[i + 1] * aw + bd[i + 1] * bw;
      od[i + 2] = ad[i + 2] * aw + bd[i + 2] * bw;
      od[i + 3] = ad[i + 3] * aw + bd[i + 3] * bw;
    }
  }
  // Sanity: at t=1 the entire frame should be from b. The feather
  // band can leave a tiny annulus of a at the corners; force-paint b
  // when r ≥ maxR to keep the contract.
  if (tt >= 1) {
    for (let i = 0; i < od.length; i += 4) {
      od[i] = bd[i]; od[i + 1] = bd[i + 1]; od[i + 2] = bd[i + 2]; od[i + 3] = bd[i + 3];
    }
  }
  return out;
}

function PushZoom(a, b, t, _params) {
  checkPair(a, b);
  const tt = clampT(t);
  const w = a.width, h = a.height;
  const out = makeOut(w, h);
  const ad = a.data, bd = b.data, od = out.data;
  // a zooms out (scale > 1, fades), b zooms in (scale < 1 → 1, fades in).
  // Scale-out & scale-in around the canvas centre, then crossfade.
  const aScale = 1 + tt * 0.5;          // 1.0 → 1.5
  const bScale = 0.5 + tt * 0.5;        // 0.5 → 1.0
  const cx = (w - 1) * 0.5;
  const cy = (h - 1) * 0.5;
  // Pre-compute inverse scales for the reverse-map.
  const invA = 1 / aScale;
  const invB = 1 / bScale;
  const inv = 1 - tt;
  for (let y = 0; y < h; y += 1) {
    const dy = y - cy;
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const dx = x - cx;
      // sample a
      const ax = Math.round(cx + dx * invA);
      const ay = Math.round(cy + dy * invA);
      let ar = 0, ag = 0, ab = 0, aa = 0;
      if (ax >= 0 && ax < w && ay >= 0 && ay < h) {
        const j = (ay * w + ax) * 4;
        ar = ad[j]; ag = ad[j + 1]; ab = ad[j + 2]; aa = ad[j + 3];
      }
      // sample b
      const bx = Math.round(cx + dx * invB);
      const by = Math.round(cy + dy * invB);
      let br = 0, bg = 0, bb = 0, ba = 0;
      if (bx >= 0 && bx < w && by >= 0 && by < h) {
        const j = (by * w + bx) * 4;
        br = bd[j]; bg = bd[j + 1]; bb = bd[j + 2]; ba = bd[j + 3];
      }
      od[i]     = ar * inv + br * tt;
      od[i + 1] = ag * inv + bg * tt;
      od[i + 2] = ab * inv + bb * tt;
      od[i + 3] = aa * inv + ba * tt;
    }
  }
  return out;
}

// ─── Registry ───────────────────────────────────────────────────────

const KINDS = [
  { kind: 'CrossFade',           fn: CrossFade,
    description: 'Linear blend between two frames.' },
  { kind: 'Wipe',                fn: Wipe,
    description: 'Boundary wipe; left/right or top/bottom.' },
  { kind: 'Slide',               fn: Slide,
    description: 'Second frame slides in from a chosen side.' },
  { kind: 'Dissolve',            fn: Dissolve,
    description: 'Random per-pixel reveal.' },
  { kind: 'Iris',                fn: Iris,
    description: 'Centred circular reveal.' },
  { kind: 'PushZoom',            fn: PushZoom,
    description: 'Outgoing zooms out, incoming zooms in.' },
];

for (const k of KINDS) _TRANSITIONS.set(k.kind, k);

// Optionally hook into the slice-690 VSE engine.
function tryRegisterWithVSE() {
  if (typeof window === 'undefined') return false;
  const reg = window.__studioVSERegisterTransition;
  if (typeof reg !== 'function') return false;
  let n = 0;
  for (const k of KINDS) {
    try { reg(k.kind, k.fn); n += 1; } catch (_) { /* keep going */ }
  }
  return n > 0;
}

// ─── Public API ─────────────────────────────────────────────────────

export function listTransitions() {
  return Array.from(_TRANSITIONS.keys());
}

export function getTransition(kind) {
  const k = _TRANSITIONS.get(String(kind || ''));
  return k ? k.fn : null;
}

export function applyTransition(kind, a, b, t, params) {
  const fn = getTransition(kind);
  if (!fn) throw new Error(`VSEFX: unknown transition kind "${kind}"`);
  return fn(a, b, t, params || {});
}

// window-level helper used by index.js — exposed here so tests can
// reach in without bouncing through the install layer.
export function installWindowHook() {
  if (typeof window === 'undefined') return false;
  window.__studioVSEFXApply = (kind, a, b, t, params) =>
    applyTransition(kind, a, b, t, params || {});
  tryRegisterWithVSE();
  return true;
}

export default {
  list: listTransitions,
  get: getTransition,
  apply: applyTransition,
  installWindowHook,
};
