// ArchDisc Studio V3 — ZBrush localized brush kernels (slice 758).
//
// Pure per-mode displacement kernels factored out of WorkbenchStudio.jsx's
// `paintBrushAt`. Each kernel returns the per-vertex displacement vec3 a
// caller should ADD to the vertex's local-space position. This module
// makes the seven Blender / ZBrush canonical sculpt modes individually
// addressable and testable, without coupling to mesh state or scene
// patching (slice 684 already handles that for the mesh-walking brushes).
//
// Why a separate module:
//   - paintBrushAt's stroke routine mixes mode dispatch, mesh iteration
//     and X-symmetry on a single ~200-line function. The DCC Parity row
//     "Localized brush sculpt (draw/inflate/crease/pinch/flatten/grab/
//     smooth)" was PARTIAL: only paintBrushAt + symmetry were verified.
//   - These kernels are pure: `(vert, normal, strength, falloff, ctx?)
//     → [dx, dy, dz]`. Callers compose with falloff curves from
//     `./falloffCurves.js` and a falloff value `t ∈ [0..1]` (1 at the
//     brush centre, 0 at the rim) to drive a single-vertex stroke.
//
// Contract:
//   kernel(vert, normal, strength, falloff, ctx?) → [dx, dy, dz]
//     vert     [x, y, z]  — vertex local position (Float)
//     normal   [nx, ny, nz] — UNIT vertex normal (Float)
//     strength scalar     — caller-supplied magnitude multiplier
//     falloff  scalar     — already-evaluated radial weight (0..1)
//     ctx      object     — optional shared per-stroke context:
//                            ctx.center   [cx, cy, cz]   brush centre
//                            ctx.motion   [mx, my, mz]   grab delta
//                            ctx.plane    {normal, point} flatten plane
//                            ctx.smooth   {target}        laplacian target
//
// The displacements are deterministic & side-effect free. The exported
// table KERNELS preserves canonical order (draw, inflate, crease, pinch,
// flatten, grab, smooth) so callers can iterate in a stable order for
// the verifyAll smoke op.

// Defensive: guarantee numeric vec3 inputs even if caller hands us nulls.
function _vec3(v) {
  if (!v) return [0, 0, 0];
  if (Array.isArray(v)) return [+v[0] || 0, +v[1] || 0, +v[2] || 0];
  if (typeof v === 'object' && typeof v.x === 'number') {
    return [+v.x || 0, +v.y || 0, +v.z || 0];
  }
  return [0, 0, 0];
}

// Re-normalise a vec3 in place; returns the unit vector or a fallback.
function _unit(v, fallback) {
  const x = +v[0] || 0, y = +v[1] || 0, z = +v[2] || 0;
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len < 1e-9) {
    return fallback || [0, 1, 0];
  }
  return [x / len, y / len, z / len];
}

// ─── 1. DRAW — along normal by strength * falloff ─────────────────────
// The default ZBrush DRAW (and Blender Sculpt → Draw). Pushes the vertex
// out along its surface normal, scaled by the brush radial falloff so
// the centre rises into a soft bump.
export function drawKernel(vert, normal, strength, falloff /* ctx */) {
  const n = _unit(_vec3(normal));
  const w = (+strength || 0) * (+falloff || 0);
  return [n[0] * w, n[1] * w, n[2] * w];
}

// ─── 2. INFLATE — positive along normal ────────────────────────────────
// ZBrush Inflate / Blender Inflate. Behaviourally identical to DRAW in
// the simplest formulation; we keep it separate because the
// `paintBrushAt` patch in slice 684 treats Inflate as "positive
// volumetric expansion" with a stronger overall scalar, and downstream
// kernels may diverge. The 1.2× factor matches paintBrushAt's
// `mode === 'inflate'` path which lacks the 0.5× clamp on `k`.
export function inflateKernel(vert, normal, strength, falloff /* ctx */) {
  const n = _unit(_vec3(normal));
  const w = (+strength || 0) * (+falloff || 0) * 1.2;
  return [n[0] * w, n[1] * w, n[2] * w];
}

// ─── 3. CREASE — along inverted normal, narrow falloff (sharp valley) ─
// ZBrush Crease / Blender Crease. Pulls along the INVERTED normal to
// carve a valley, with a narrowed effective weight so the trough stays
// sharp. We square the falloff to deliberately tighten the radius
// (matches `paintBrushAt`'s "pinch toward the brush plane" feel).
export function creaseKernel(vert, normal, strength, falloff /* ctx */) {
  const n = _unit(_vec3(normal));
  const f = +falloff || 0;
  // Narrowed falloff (f²) → sharper trough than DRAW.
  const w = -(+strength || 0) * f * f;
  return [n[0] * w, n[1] * w, n[2] * w];
}

// ─── 4. PINCH — toward brush centre ────────────────────────────────────
// ZBrush Pinch / Blender Pinch. Pulls the vertex toward the brush
// centre, scaled by falloff. Distinct from CREASE in that it has no
// normal component — purely lateral compression in the tangent plane
// of the stroke (well, of the vertex offset).
export function pinchKernel(vert, normal, strength, falloff, ctx) {
  const v = _vec3(vert);
  const c = (ctx && ctx.center) ? _vec3(ctx.center) : [0, 0, 0];
  const dx = c[0] - v[0], dy = c[1] - v[1], dz = c[2] - v[2];
  const w = (+strength || 0) * (+falloff || 0) * 0.6;
  return [dx * w, dy * w, dz * w];
}

// ─── 5. FLATTEN — project onto local brush plane ───────────────────────
// ZBrush Flatten / Blender Flatten. Projects the vertex onto a local
// plane defined by ctx.plane = { normal, point }, where the caller is
// expected to pass the average normal + centroid of the affected
// vertex set (the "brush plane" — Blender's Flatten brush plane).
// Without a plane, this kernel falls back to the vertex's own normal,
// which collapses to zero displacement at the centre of an isolated
// vertex — still a valid no-op flatten.
export function flattenKernel(vert, normal, strength, falloff, ctx) {
  const v = _vec3(vert);
  const planeN = (ctx && ctx.plane && ctx.plane.normal)
    ? _unit(_vec3(ctx.plane.normal))
    : _unit(_vec3(normal));
  const planeP = (ctx && ctx.plane && ctx.plane.point)
    ? _vec3(ctx.plane.point)
    : v.slice();
  // Signed distance from vertex to plane.
  const sd = (v[0] - planeP[0]) * planeN[0]
           + (v[1] - planeP[1]) * planeN[1]
           + (v[2] - planeP[2]) * planeN[2];
  const w = (+strength || 0) * (+falloff || 0);
  // Move the vertex AGAINST the plane normal by its signed distance —
  // when w=1 the vertex lands on the plane (full flatten).
  return [-planeN[0] * sd * w, -planeN[1] * sd * w, -planeN[2] * sd * w];
}

// ─── 6. GRAB — translate by brush motion vec ───────────────────────────
// ZBrush Move (Grab) / Blender Grab. Translates by the stroke's motion
// vector — passed in `ctx.motion` — scaled by falloff. No normal
// component. Without ctx.motion this kernel is a no-op (Grab without a
// drag direction is meaningless).
export function grabKernel(vert, normal, strength, falloff, ctx) {
  const m = (ctx && ctx.motion) ? _vec3(ctx.motion) : [0, 0, 0];
  const w = (+strength || 0) * (+falloff || 0);
  return [m[0] * w, m[1] * w, m[2] * w];
}

// ─── 7. SMOOTH — laplacian average with neighbours ─────────────────────
// ZBrush Smooth / Blender Smooth. Pulls the vertex toward the average
// of its neighbours, scaled by falloff. The neighbour average must be
// supplied via `ctx.smooth.target` (a vec3). Without it, the kernel
// emits zero displacement (we can't infer neighbours from a single
// vertex). This keeps the kernel pure — actual neighbour gathering
// stays in `paintBrushAt` / the installer above.
export function smoothKernel(vert, normal, strength, falloff, ctx) {
  const v = _vec3(vert);
  const t = (ctx && ctx.smooth && ctx.smooth.target)
    ? _vec3(ctx.smooth.target)
    : v.slice();
  const w = (+strength || 0) * (+falloff || 0);
  return [(t[0] - v[0]) * w, (t[1] - v[1]) * w, (t[2] - v[2]) * w];
}

// Canonical export table — preserves the slice brief's required order
// so verifyAll iterates in a stable, brief-aligned sequence.
export const KERNELS = Object.freeze({
  draw:    drawKernel,
  inflate: inflateKernel,
  crease:  creaseKernel,
  pinch:   pinchKernel,
  flatten: flattenKernel,
  grab:    grabKernel,
  smooth:  smoothKernel,
});

export const KERNEL_NAMES = Object.freeze([
  'draw', 'inflate', 'crease', 'pinch', 'flatten', 'grab', 'smooth',
]);

// Resolve a kernel by name. Returns null on unknown name — callers can
// surface a "valid: KERNEL_NAMES" error to the op layer.
export function getKernel(name) {
  if (!name) return null;
  return KERNELS[String(name).toLowerCase()] || null;
}

export default KERNELS;
