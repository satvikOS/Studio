// ArchDisc Studio V3 — ZBrush falloff curve catalogue (slice 758).
//
// Five canonical brush-falloff shapes that every DCC sculpt tool ships
// (ZBrush "Brush > Falloff", Blender "Sculpt > Custom Curve", Mudbox
// "Curve Profile", Nomad "Falloff Curve"). Each curve is a pure
// `(t) → w` function in [0..1] where:
//
//   t = 1 at the brush centre (vertex IS the centre point)
//   t = 0 at the brush rim    (vertex is exactly at the radius)
//
// This convention matches `common/brush.js` `smoothFalloff(t)` and the
// `applyBrushOnVertices` helper, so kernels written against these
// curves drop straight into the existing brush-walking infrastructure.
//
// Curves:
//   linear   — w = t                    (the no-op baseline)
//   smooth   — smoothstep cubic         (ZBrush default; Blender Smooth)
//   sphere   — sqrt(1 - (1-t)²)         (rounded cap, ZBrush Sphere)
//   sharp    — t²                       (narrow point, ZBrush Sharp)
//   constant — w = 1 for t > 0, else 0  (ZBrush Constant)
//
// All curves clamp their input to [0..1]. They are pure / deterministic
// / dependency-free; safe to call inside the brush per-vertex loop.

function _clamp01(t) {
  return t <= 0 ? 0 : (t >= 1 ? 1 : t);
}

// 1) LINEAR — w = t. Plain triangular falloff. Mainly useful as a
// debugging baseline ("does my kernel respect falloff at all?") and for
// users who want a cone profile.
export function linearCurve(t) {
  return _clamp01(t);
}

// 2) SMOOTH — smoothstep cubic, t² · (3 − 2t). The Blender / ZBrush
// default. Mirrors `common/brush.js` `smoothFalloff`. Smooth at both
// ends (zero first derivative at t=0 and t=1).
export function smoothCurve(t) {
  const x = _clamp01(t);
  return x * x * (3 - 2 * x);
}

// 3) SPHERE — quarter-circle profile w = √(1 − (1 − t)²). Produces a
// rounded dome stamp (ZBrush "Sphere" falloff). Strong centre, narrow
// rim.
export function sphereCurve(t) {
  const x = _clamp01(t);
  const u = 1 - x;
  const inner = 1 - u * u;
  // Numeric guard against tiny negatives from floating-point.
  return Math.sqrt(inner < 0 ? 0 : inner);
}

// 4) SHARP — w = t². Narrow point, mainly tail. ZBrush "Sharp"; useful
// for crease / pinch where you want a tight spike of effect at the
// brush centre.
export function sharpCurve(t) {
  const x = _clamp01(t);
  return x * x;
}

// 5) CONSTANT — w = 1 for any t in (0, 1], 0 otherwise. ZBrush
// "Constant" / hard cylinder falloff. Useful for masking and
// pixel-precise stamps.
export function constantCurve(t) {
  return t > 0 ? 1 : 0;
}

export const CURVES = Object.freeze({
  linear:   linearCurve,
  smooth:   smoothCurve,
  sphere:   sphereCurve,
  sharp:    sharpCurve,
  constant: constantCurve,
});

export const CURVE_NAMES = Object.freeze([
  'linear', 'smooth', 'sphere', 'sharp', 'constant',
]);

// Resolve a curve by name. Returns null on unknown name (so the op layer
// can surface `valid: CURVE_NAMES`).
export function getCurve(name) {
  if (!name) return null;
  return CURVES[String(name).toLowerCase()] || null;
}

export default CURVES;
