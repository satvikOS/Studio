// ArchDisc Studio V3 — ZBrush Pro 50+ named brush catalogue (slice 782).
//
// Slice 758 shipped the 7 canonical sculpt KERNELS (draw / inflate /
// crease / pinch / flatten / grab / smooth) + 5 falloff CURVES. Real
// ZBrush ships ~200 named brushes which are all PARAMETERIZED
// CONFIGURATIONS of the same handful of primitive kernels (e.g.
// "Clay" = flatten + draw composite, "ClayBuildup" = clay with stronger
// inflation, "Standard" = the bare draw, "DamStandard" = crease with a
// narrow sharp falloff, "hPolish" = flatten with sharp falloff and only
// affecting high points, etc.).
//
// This module exposes that mapping as a flat list of 50+ named brush
// presets. Each entry is:
//
//   {
//     name:        'Clay',                // canonical ZBrush brush name
//     baseKernel:  'flatten' | 'draw' | …, // resolved against KERNELS
//     params:      { strength, scale, normalBias, … }, // per-brush tuning
//     falloff:     'smooth' | 'sphere' | 'sharp' | …,
//     description: 'Flatten-and-add build-up; bread-and-butter additive.',
//     category:    'sculpt' | 'mask' | 'curve' | …,
//   }
//
// `composite` brushes blend two kernels (e.g. Clay = flatten + draw).
// In that case `baseKernel` is the dominant kernel and `params.blend`
// names the secondary kernel + its weight: `{ blend: ['draw', 0.6] }`.
//
// The index.js applyBrush walks the entry, calls slice 758's installed
// `__studioZBrushBrush` op once for each kernel in the composite, with
// the params interpolated against the user-supplied { center, radius,
// strength }. Reusing slice 758's op means every brush automatically
// inherits its falloff-curve plumbing, undo push, BVH refresh, and
// neighbour cache — no parallel sculpt engine.
//
// Categories follow real ZBrush's brush palette tabs:
//   - 'sculpt'   : the displacement brushes (Clay/Standard/Inflate/…)
//   - 'mask'     : brushes that paint into the mask buffer
//   - 'curve'    : stroke-path brushes (CurveStrap/CurveTubeSnap/…)
//   - 'insert'   : brushes that drop a mesh primitive (InsertSphere/…)
//   - 'topology' : retopology / ZModeler brushes
//   - 'project'  : Spotlight/Stencil image-based brushes
//   - 'utility'  : Reproject/Pinch3D/etc.

// All 50+ entries — frozen so callers cannot mutate the catalogue in
// place.  Order is meaningful: a __studioZBrushProListBrushes() call
// returns names in catalogue order so the UI list is reproducible.
//
// Notes on composite semantics (see applyBrush in index.js):
//   blend: ['<kernel>', <weight>]
//     After the primary kernel pass, run the named kernel with
//     `strength = userStrength * weight` and `radius = userRadius *
//     (params.blendRadius || 1)`. The two passes ACCUMULATE.
//
//   invert: true
//     Multiply the user-supplied strength by -1 before applying. Used
//     for "Concave Clay" / "Layer Negative" / etc.
//
//   sharpness: n (1..3)
//     For draw-flavoured brushes: feed the kernel through `sharp`
//     falloff and raise the strength to the n-th-power. n=1 ≈ Standard,
//     n=2 ≈ DrawSharp, n=3 ≈ DamStandard valley.
//
//   directionalBand: w  (0..1)
//     Slash/Cap/Floor flavoured brushes: only verts whose perpendicular
//     distance to the stroke direction is <  w * radius receive any
//     displacement.  Without a stroke direction in ctx, the band rule
//     is skipped (kernel becomes its un-narrowed self).

export const ZBRUSH_PRO_CATALOG = Object.freeze([
  // ── 1-10: standard additive draw family ─────────────────────────────
  { name: 'Standard',       baseKernel: 'draw',    params: { strengthScale: 1.0 },
    falloff: 'smooth', category: 'sculpt',
    description: 'Default ZBrush brush — push verts along normal with smooth falloff.' },
  { name: 'StandardSharp',  baseKernel: 'draw',    params: { strengthScale: 1.0, sharpness: 2 },
    falloff: 'sharp',  category: 'sculpt',
    description: 'Standard with sharp falloff (pointed tip).' },
  { name: 'Clay',           baseKernel: 'flatten', params: { strengthScale: 0.5, blend: ['draw', 0.6] },
    falloff: 'smooth', category: 'sculpt',
    description: 'Flatten + push along plane normal; ZBrush\'s bread-and-butter additive.' },
  { name: 'ClayBuildup',    baseKernel: 'flatten', params: { strengthScale: 0.45, blend: ['inflate', 0.8] },
    falloff: 'smooth', category: 'sculpt',
    description: 'Clay with stronger build-up — accumulates volume faster than Clay.' },
  { name: 'ClayTubes',      baseKernel: 'flatten', params: { strengthScale: 0.4, blend: ['draw', 0.7], stripes: 6 },
    falloff: 'smooth', category: 'sculpt',
    description: 'Clay with linear stripe alpha — drags tubes of clay.' },
  { name: 'ClayPolish',     baseKernel: 'flatten', params: { strengthScale: 0.8, blend: ['smooth', 0.5] },
    falloff: 'smooth', category: 'sculpt',
    description: 'Clay + smoothing pass — softens the build-up edges.' },
  { name: 'Inflate',        baseKernel: 'inflate', params: { strengthScale: 1.0 },
    falloff: 'smooth', category: 'sculpt',
    description: 'Push along vertex normal — balloons the surface outward.' },
  { name: 'Magnify',        baseKernel: 'inflate', params: { strengthScale: 1.4, radial: true },
    falloff: 'smooth', category: 'sculpt',
    description: 'Radial outward scale from stroke centre — lens distortion.' },
  { name: 'Bulge',          baseKernel: 'inflate', params: { strengthScale: 1.2, sharpness: 1 },
    falloff: 'sphere', category: 'sculpt',
    description: 'Sphere-falloff inflate — rounded dome bulge.' },
  { name: 'Stretch',        baseKernel: 'grab',    params: { strengthScale: 1.5, stretchMode: true },
    falloff: 'smooth', category: 'sculpt',
    description: 'Pull verts in stroke direction — taffy-like stretch.' },

  // ── 11-20: subtractive / sharpening family ──────────────────────────
  { name: 'DamStandard',    baseKernel: 'crease',  params: { strengthScale: 1.0, sharpness: 2 },
    falloff: 'sharp',  category: 'sculpt',
    description: 'Sharp narrow valley — Damien Canderle\'s famous crease brush.' },
  { name: 'Crease',         baseKernel: 'crease',  params: { strengthScale: 1.0 },
    falloff: 'smooth', category: 'sculpt',
    description: 'Carve a crease line along stroke path; inward along normal.' },
  { name: 'Slash',          baseKernel: 'crease',  params: { strengthScale: 0.9, directionalBand: 0.25 },
    falloff: 'smooth', category: 'sculpt',
    description: 'Narrow directional cut — cleaves a groove along stroke direction.' },
  { name: 'Slash2',         baseKernel: 'crease',  params: { strengthScale: 1.1, directionalBand: 0.2, sharpness: 2 },
    falloff: 'sharp',  category: 'sculpt',
    description: 'Slash with sharper tip — narrower, deeper cut.' },
  { name: 'Slash3',         baseKernel: 'crease',  params: { strengthScale: 0.7, directionalBand: 0.35 },
    falloff: 'smooth', category: 'sculpt',
    description: 'Wider Slash — broader groove than Slash.' },
  { name: 'Pinch',          baseKernel: 'pinch',   params: { strengthScale: 1.0 },
    falloff: 'smooth', category: 'sculpt',
    description: 'Pull verts toward stroke centre — tighten edges.' },
  { name: 'Pinch3D',        baseKernel: 'pinch',   params: { strengthScale: 1.3, normalBlend: 0.4 },
    falloff: 'sharp',  category: 'sculpt',
    description: 'Pinch with normal-bias term — pinches tangentially AND inward.' },
  { name: 'Trim',           baseKernel: 'flatten', params: { strengthScale: 1.0, highOnly: true },
    falloff: 'smooth', category: 'sculpt',
    description: 'Flatten only HIGH points — Trim Dynamic / scrape behaviour.' },
  { name: 'TrimDynamic',    baseKernel: 'flatten', params: { strengthScale: 1.2, highOnly: true, dynamicPlane: true },
    falloff: 'smooth', category: 'sculpt',
    description: 'Trim with per-stroke dynamic plane fit.' },
  { name: 'TrimSmoothBorder', baseKernel: 'flatten', params: { strengthScale: 1.0, highOnly: true, blend: ['smooth', 0.3] },
    falloff: 'smooth', category: 'sculpt',
    description: 'Trim with a smoothed border ring — softens the cut edge.' },

  // ── 21-30: polishing / smoothing / surface family ───────────────────
  { name: 'Smooth',         baseKernel: 'smooth',  params: { strengthScale: 1.0 },
    falloff: 'smooth', category: 'sculpt',
    description: 'Laplacian smooth — pulls verts toward neighbour average.' },
  { name: 'SmoothStronger', baseKernel: 'smooth',  params: { strengthScale: 1.8 },
    falloff: 'smooth', category: 'sculpt',
    description: 'Smooth with 1.8× strength — collapses noise faster.' },
  { name: 'SmoothPeaks',    baseKernel: 'smooth',  params: { strengthScale: 1.3, highOnly: true },
    falloff: 'smooth', category: 'sculpt',
    description: 'Smooth only HIGH peaks — preserves crevices.' },
  { name: 'SmoothValleys',  baseKernel: 'smooth',  params: { strengthScale: 1.3, lowOnly: true },
    falloff: 'smooth', category: 'sculpt',
    description: 'Smooth only LOW valleys — preserves peaks.' },
  { name: 'Polish',         baseKernel: 'flatten', params: { strengthScale: 0.8, blend: ['smooth', 0.4] },
    falloff: 'smooth', category: 'sculpt',
    description: 'Flatten + smooth — buffed metal feel.' },
  { name: 'HPolish',        baseKernel: 'flatten', params: { strengthScale: 1.0, highOnly: true, blend: ['smooth', 0.5] },
    falloff: 'sharp',  category: 'sculpt',
    description: 'Hard Polish — sharp-falloff polish that only chases high points.' },
  { name: 'PlanarBrush',    baseKernel: 'flatten', params: { strengthScale: 1.0 },
    falloff: 'constant', category: 'sculpt',
    description: 'Flatten with constant falloff — hard-edged planar press.' },
  { name: 'Flatten',        baseKernel: 'flatten', params: { strengthScale: 1.0 },
    falloff: 'smooth', category: 'sculpt',
    description: 'Project verts onto the stroke plane — classic ZBrush Flatten.' },
  { name: 'ClayPolish2',    baseKernel: 'flatten', params: { strengthScale: 0.9, blend: ['smooth', 0.6], invert: false },
    falloff: 'smooth', category: 'sculpt',
    description: 'Alternate clay polish profile — gentler smoothing pass.' },
  { name: 'Planar',         baseKernel: 'flatten', params: { strengthScale: 1.0, highOnly: false, lowOnly: false },
    falloff: 'linear', category: 'sculpt',
    description: 'Linear-falloff flatten — gradient toward the rim.' },

  // ── 31-40: move / drag / form-finding family ────────────────────────
  { name: 'Move',           baseKernel: 'grab',    params: { strengthScale: 1.0 },
    falloff: 'smooth', category: 'sculpt',
    description: 'Drag verts by motion vector — ZBrush Move.' },
  { name: 'MoveTopo',       baseKernel: 'grab',    params: { strengthScale: 1.0, topological: true },
    falloff: 'smooth', category: 'sculpt',
    description: 'Move that propagates along TOPOLOGICAL neighbours, not 3D distance.' },
  { name: 'MoveElastic',    baseKernel: 'grab',    params: { strengthScale: 0.9, blend: ['smooth', 0.3] },
    falloff: 'smooth', category: 'sculpt',
    description: 'Move with elastic smoothing pass — recovers shape after stroke.' },
  { name: 'MoveParts',      baseKernel: 'grab',    params: { strengthScale: 1.2, polyGroupAware: true },
    falloff: 'constant', category: 'sculpt',
    description: 'Move that only affects ONE polygroup at a time.' },
  { name: 'SnakeHook',      baseKernel: 'grab',    params: { strengthScale: 1.5, falloffDecay: 0.7 },
    falloff: 'sharp',  category: 'sculpt',
    description: 'Pull tip out into a horn — SnakeHook.' },
  { name: 'SnakeCurve',     baseKernel: 'grab',    params: { strengthScale: 1.3, curveDriven: true },
    falloff: 'smooth', category: 'curve',
    description: 'SnakeHook driven by a stroke curve — extrudes along path.' },
  { name: 'Nudge',          baseKernel: 'grab',    params: { strengthScale: 0.4, tangentialOnly: true },
    falloff: 'smooth', category: 'sculpt',
    description: 'Small surface-tangential slide — Nudge.' },
  { name: 'Layer',          baseKernel: 'draw',    params: { strengthScale: 0.6, fixedHeight: true },
    falloff: 'smooth', category: 'sculpt',
    description: 'Fixed-height bump — Layer brush.' },
  { name: 'LayerNeg',       baseKernel: 'draw',    params: { strengthScale: 0.6, fixedHeight: true, invert: true },
    falloff: 'smooth', category: 'sculpt',
    description: 'Inverse Layer — fixed-height inset.' },
  { name: 'Thumb',          baseKernel: 'grab',    params: { strengthScale: 0.5, tangentialOnly: true, sharpness: 2 },
    falloff: 'sphere', category: 'sculpt',
    description: 'Shear push tangential to surface — like thumb pressure.' },

  // ── 41-50: masking / curve / topology / project family ─────────────
  { name: 'Mask',           baseKernel: 'mask',    params: { strengthScale: 1.0 },
    falloff: 'smooth', category: 'mask',
    description: 'Paint into the sculpt mask buffer.' },
  { name: 'MaskPen',        baseKernel: 'mask',    params: { strengthScale: 1.0, sharpness: 2 },
    falloff: 'sharp',  category: 'mask',
    description: 'Sharp-edged mask paint.' },
  { name: 'MaskRect',       baseKernel: 'mask',    params: { strengthScale: 1.0 },
    falloff: 'constant', category: 'mask',
    description: 'Hard-rectangle mask paint (constant falloff).' },
  { name: 'MaskCurve',      baseKernel: 'mask',    params: { strengthScale: 1.0, curveDriven: true },
    falloff: 'smooth', category: 'curve',
    description: 'Mask painted along a curve path.' },
  { name: 'CurveStrap',     baseKernel: 'draw',    params: { strengthScale: 0.9, curveDriven: true, ribbonWidth: 0.3 },
    falloff: 'smooth', category: 'curve',
    description: 'Ribbon strap drawn along a curve.' },
  { name: 'CurveTubeSnap',  baseKernel: 'draw',    params: { strengthScale: 1.0, curveDriven: true, tubeRadius: 0.3 },
    falloff: 'sphere', category: 'curve',
    description: 'Tube cross-section snapped along a curve.' },
  { name: 'InsertSphere',   baseKernel: 'draw',    params: { strengthScale: 1.0, insertPrimitive: 'sphere' },
    falloff: 'constant', category: 'insert',
    description: 'Insert a sphere primitive at brush centre.' },
  { name: 'InsertCube',     baseKernel: 'draw',    params: { strengthScale: 1.0, insertPrimitive: 'cube' },
    falloff: 'constant', category: 'insert',
    description: 'Insert a cube primitive at brush centre.' },
  { name: 'InsertCylinder', baseKernel: 'draw',    params: { strengthScale: 1.0, insertPrimitive: 'cylinder' },
    falloff: 'constant', category: 'insert',
    description: 'Insert a cylinder primitive at brush centre.' },
  { name: 'Spotlight',      baseKernel: 'draw',    params: { strengthScale: 1.0, projected: true },
    falloff: 'smooth', category: 'project',
    description: 'Project image-based displacement onto the surface.' },

  // ── 51-60: extended brushes (extra coverage) ───────────────────────
  { name: 'Stencil',        baseKernel: 'draw',    params: { strengthScale: 1.0, projected: true, alpha: 'stencil' },
    falloff: 'sharp',  category: 'project',
    description: 'Stencil-driven displacement — alpha-pattern stamp.' },
  { name: 'Topology',       baseKernel: 'grab',    params: { strengthScale: 0.0, topological: true, retopoMode: true },
    falloff: 'constant', category: 'topology',
    description: 'Topology brush — retopo over surface (no displacement, draws strokes).' },
  { name: 'ZModeler',       baseKernel: 'grab',    params: { strengthScale: 0.0, polyOpMode: true },
    falloff: 'constant', category: 'topology',
    description: 'ZModeler — polygon-level operations (extrude/inset/bevel).' },
  { name: 'Vector',         baseKernel: 'draw',    params: { strengthScale: 1.0, vectorDisp: true },
    falloff: 'smooth', category: 'sculpt',
    description: 'Vector displacement brush — sculpts along arbitrary direction.' },
  { name: 'Cap',            baseKernel: 'flatten', params: { strengthScale: 1.0, directionalBand: 0.3, highOnly: true },
    falloff: 'sharp',  category: 'sculpt',
    description: 'Cap brush — directional flat top.' },
  { name: 'Floor',          baseKernel: 'flatten', params: { strengthScale: 1.0, directionalBand: 0.3, lowOnly: true },
    falloff: 'sharp',  category: 'sculpt',
    description: 'Floor brush — directional flat bottom.' },
  { name: 'Reproject',      baseKernel: 'smooth',  params: { strengthScale: 1.0, reprojectMode: true },
    falloff: 'smooth', category: 'utility',
    description: 'Reproject detail onto current surface — Reproject Higher Subdiv.' },
  { name: 'Cloth',          baseKernel: 'grab',    params: { strengthScale: 0.9, clothMode: true, blend: ['smooth', 0.3] },
    falloff: 'smooth', category: 'sculpt',
    description: 'Cloth brush — drag with soft body relax.' },
  { name: 'ClothPinch',     baseKernel: 'pinch',   params: { strengthScale: 0.8, clothMode: true, blend: ['smooth', 0.2] },
    falloff: 'smooth', category: 'sculpt',
    description: 'Cloth pinch — pulls fabric together with relax.' },
  { name: 'ClothPush',      baseKernel: 'draw',    params: { strengthScale: 0.7, clothMode: true, blend: ['smooth', 0.3] },
    falloff: 'smooth', category: 'sculpt',
    description: 'Cloth push — drape outward with relax.' },

  // ── 61-65: final misc ──────────────────────────────────────────────
  { name: 'PlanarCut',      baseKernel: 'flatten', params: { strengthScale: 1.4, directionalBand: 0.5 },
    falloff: 'constant', category: 'sculpt',
    description: 'Hard planar slice — directional flatten band.' },
  { name: 'MaskLasso',      baseKernel: 'mask',    params: { strengthScale: 1.0, lassoMode: true },
    falloff: 'constant', category: 'mask',
    description: 'Lasso polygonal mask paint.' },
  { name: 'MaskFade',       baseKernel: 'mask',    params: { strengthScale: 0.5 },
    falloff: 'smooth', category: 'mask',
    description: 'Soft mask paint — additive feathered weight.' },
  { name: 'Erase',          baseKernel: 'draw',    params: { strengthScale: 0.6, invert: true },
    falloff: 'smooth', category: 'sculpt',
    description: 'Inverse draw — pushes inward.' },
  { name: 'NudgeTangent',   baseKernel: 'grab',    params: { strengthScale: 0.3, tangentialOnly: true, sharpness: 1 },
    falloff: 'smooth', category: 'sculpt',
    description: 'Surface-tangent micro-slide — micro nudge.' },
]);

// Canonical category order — used by __studioZBrushProCategories().
export const ZBRUSH_PRO_CATEGORIES = Object.freeze([
  'sculpt', 'mask', 'curve', 'insert', 'topology', 'project', 'utility',
]);

// Build a name → entry index lookup. O(1) lookups inside applyBrush.
const _byName = (() => {
  const m = Object.create(null);
  for (let i = 0; i < ZBRUSH_PRO_CATALOG.length; i++) {
    m[ZBRUSH_PRO_CATALOG[i].name.toLowerCase()] = ZBRUSH_PRO_CATALOG[i];
  }
  return m;
})();

// Resolve a brush entry by case-insensitive name. Returns null on miss.
export function getBrushEntry(name) {
  if (!name) return null;
  return _byName[String(name).toLowerCase()] || null;
}

// Return all brush names in catalogue order.
export function listBrushNames() {
  return ZBRUSH_PRO_CATALOG.map((e) => e.name);
}

// Return all distinct categories present in the catalogue, in canonical
// order. Skips any category that no brush uses.
export function listCategories() {
  const present = new Set();
  for (const b of ZBRUSH_PRO_CATALOG) present.add(b.category);
  return ZBRUSH_PRO_CATEGORIES.filter((c) => present.has(c));
}

export default ZBRUSH_PRO_CATALOG;
