// ArchDisc Studio V3 — shared brush falloff + per-vertex apply.
//
// Before dedup, soft falloff math was reimplemented in:
//   - sculpt/* (sculpt brush in api.js + sculpt index)
//   - sculptbrushes/brushes.js (_falloff — smoothstep)
//   - texpaint/paint.js (radial gradient in canvas-space, indirectly)
//
// This module exposes the two flavours that callers actually need:
//
//   softFalloff(r, hardness)   — Pow falloff matching api.js sculpt brush.
//   smoothFalloff(t)           — Smoothstep 0..1 (matches sculptbrushes).
//   applyBrushOnVertices(geometry, point, radius, strength, falloffFn,
//                        perVertexFn)
//     — iterates BufferGeometry positions within radius, calls
//       perVertexFn(idx, [vx, vy, vz], weight). Caller mutates the
//       Position attribute itself (so it stays free to do per-axis or
//       per-channel logic without forcing a vec3 contract).
//
// applyBrushOnVertices does NOT touch needsUpdate / bounds — callers
// commit on their own to allow batching multiple strokes per frame.

// Pow falloff: t in [0..1], hardness in [0..1]. Bigger hardness = sharper
// rim. The 4× scaling matches api.js __studioSculptBrushApply's behaviour
// where brush.falloff is a 0..1 slider but feeds a Pow exponent.
export function softFalloff(t, hardness) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const h = (typeof hardness === 'number') ? hardness : 0.6;
  return Math.pow(t, h * 4 + 0.1);
}

// Smoothstep curve: 1 at centre (t=1), 0 at rim (t=0). Matches the
// `_falloff(t)` used throughout sculptbrushes/brushes.js.
export function smoothFalloff(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

// Iterate every vertex within `radius` of `point` (local-space). For
// each hit calls `perVertexFn(i, vx, vy, vz, weight)`. Returns the count
// of touched vertices.
//
// `point` may be a [x, y, z] array or a {x,y,z} object. `falloffFn`
// receives `t = 1 - d/r` in [0..1] — i.e. 1 at the centre, 0 at the rim.
// Pass `softFalloff` for pow-style, `smoothFalloff` for smoothstep, or
// any custom function.
export function applyBrushOnVertices(
  geometry, point, radius, strength, falloffFn, perVertexFn,
) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return 0;
  const pos = geometry.attributes.position;
  const px = Array.isArray(point) ? point[0] : (point ? +point.x : 0);
  const py = Array.isArray(point) ? point[1] : (point ? +point.y : 0);
  const pz = Array.isArray(point) ? point[2] : (point ? +point.z : 0);
  const r = Math.max(1e-6, +radius || 0);
  const r2 = r * r;
  const s = (typeof strength === 'number') ? strength : 1;
  const fn = (typeof falloffFn === 'function') ? falloffFn : smoothFalloff;
  let touched = 0;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const dx = vx - px, dy = vy - py, dz = vz - pz;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 > r2) continue;
    const d = Math.sqrt(d2);
    const t = 1 - d / r;
    const w = fn(t) * s;
    if (w === 0) continue;
    perVertexFn(i, vx, vy, vz, w);
    touched++;
  }
  return touched;
}
