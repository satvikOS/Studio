// ArchDisc Studio V3 — slice 750 — parametric primitive schemas.
//
// 3ds Max's signature "re-editable" workflow puts the primitive's
// construction parameters (radius / segments / arc / …) on the object
// itself so you can keep pulling sliders long after the cube was
// spawned. Every primitive kind that ships in V3 gets a schema here:
//
//   [min, max, step, default]
//
// SHEET 1: real BufferGeometry primitives (cube/sphere/plane/cylinder
//          /cone/torus/icosahedron/dodecahedron/tetrahedron/torus-knot)
//          → THREE.* geometry kwargs are echoed verbatim so rebuild.js
//          can splat the params into the THREE constructor.
//
// SHEET 2: "bag" kinds (voxel-cube, suzanne, teapot, color-cube, arch,
//          ogee, spline-helix, spline-wave, spline-trefoil) get a
//          single `scale` slider — these are extras / placeholders the
//          spawner already knows about (or that ship as a single
//          geometry baked at spawn time); we don't try to re-derive
//          their topology, only let the user re-scale the proxy mesh.
//
// Bag scale params share the same compact tuple shape so callers can
// build slider widgets without special-casing the kind.

// Shared single-scale schema for "bag" primitive kinds.
const SCALE_ONLY = Object.freeze({
  scale: [0.1, 5, 0.05, 1],
});

// Master schema map — `[min, max, step, default]`.
const SCHEMAS = Object.freeze({
  // Sheet 1 — real BufferGeometry primitives.
  cube: {
    width:  [0.003, 0.15, 0.0015, 0.03],
    height: [0.003, 0.15, 0.0015, 0.03],
    depth:  [0.003, 0.15, 0.0015, 0.03],
    wSeg:   [1, 32, 1, 1],
    hSeg:   [1, 32, 1, 1],
    dSeg:   [1, 32, 1, 1],
  },
  sphere: {
    radius:     [0.0015, 0.15,   0.0003, 0.018],
    widthSeg:   [3,      128,    1,      32],
    heightSeg:  [2,      64,     1,      24],
  },
  plane: {
    width:  [0.003, 0.3,  0.003, 0.048],
    height: [0.003, 0.3,  0.003, 0.048],
    wSeg:   [1,     64,   1,     1],
    hSeg:   [1,     64,   1,     1],
  },
  cylinder: {
    radiusTop:    [0,      0.15,  0.0003, 0.015],
    radiusBottom: [0,      0.15,  0.0003, 0.015],
    height:       [0.0015, 0.15,  0.0015, 0.03],
    radialSeg:    [3,      128,   1,      32],
    heightSeg:    [1,      32,    1,      1],
  },
  cone: {
    radius:    [0,      0.15, 0.0003, 0.0165],
    height:    [0.0015, 0.15, 0.0015, 0.03],
    radialSeg: [3,      128,  1,      32],
    heightSeg: [1,      32,   1,      1],
  },
  torus: {
    radius:      [0.0015, 0.15,    0.0003, 0.015],
    tube:        [0.00015, 0.03,   0.00015, 0.0054],
    radialSeg:   [3,      64,      1,      16],
    tubularSeg:  [3,      128,     1,      32],
    arc:         [0,      6.2832,  0.01,   6.2832],
  },
  icosahedron: {
    radius: [0.0015, 0.15, 0.0003, 0.018],
    detail: [0,      5,    1,      0],
  },
  dodecahedron: {
    radius: [0.0015, 0.15, 0.0003, 0.018],
    detail: [0,      5,    1,      0],
  },
  tetrahedron: {
    radius: [0.0015, 0.15, 0.0003, 0.018],
    detail: [0,      5,    1,      0],
  },
  'torus-knot': {
    radius:     [0.0015,  0.15,   0.0003,  0.0135],
    tube:       [0.00015, 0.03,   0.00015, 0.0042],
    tubularSeg: [3,       256,    1,       100],
    radialSeg:  [3,       64,     1,       16],
    p:          [1,       8,      1,       2],
    q:          [1,       8,      1,       3],
  },

  // Sheet 2 — bag primitives (single scale slider).
  'voxel-cube':     SCALE_ONLY,
  'voxel-sphere':   SCALE_ONLY,
  'suzanne':        SCALE_ONLY,
  'teapot':         SCALE_ONLY,
  'color-cube':     SCALE_ONLY,
  'arch':           SCALE_ONLY,
  'ogee':           SCALE_ONLY,
  'spline-helix':   SCALE_ONLY,
  'spline-wave':    SCALE_ONLY,
  'spline-trefoil': SCALE_ONLY,
});

// All primitive kinds we know how to re-edit. Stable order — useful for
// UI listings + e2e iteration.
export const PARAM_PRIM_KINDS = Object.freeze(Object.keys(SCHEMAS));

// Return the schema for a kind, or null when unknown. The returned
// object is the SAME frozen instance every call — callers should not
// mutate it.
export function getSchema(kind) {
  if (!kind) return null;
  return SCHEMAS[kind] || null;
}

// Build a fresh defaults dict for a kind. Each call returns a new
// plain object (so callers can edit it freely).
export function defaultParamsFor(kind) {
  const s = getSchema(kind);
  if (!s) return {};
  const out = {};
  for (const k of Object.keys(s)) out[k] = s[k][3];
  return out;
}

// Clamp `value` to the schema's min/max for `paramName` under `kind`.
// Returns the original value untouched when the kind/param is unknown.
export function clampParam(kind, paramName, value) {
  const s = getSchema(kind);
  if (!s || !s[paramName]) return value;
  const [min, max] = s[paramName];
  if (typeof value !== 'number' || !isFinite(value)) return s[paramName][3];
  return Math.max(min, Math.min(max, value));
}

// True iff `kind` has an entry in the schema map.
export function isParamPrim(kind) { return !!getSchema(kind); }
