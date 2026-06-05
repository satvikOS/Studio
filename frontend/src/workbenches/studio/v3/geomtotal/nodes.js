// ArchDisc Studio V3 — geomtotal: 30 ADDITIONAL Geometry Node kinds.
//
// Layered on top of geomnodes/ (slice 684, 8 kinds) and geomdeep/
// (slice 688, 20 kinds), this brings the V3 Geometry-Nodes inventory
// closer to Blender's 100+ entries.
//
// Each kind follows the SAME shape used by the prior slice tables so
// the slice-684 editor / graph evaluator picks them up with zero edits:
//
//   {
//     title           : string,
//     category        : string,              ← 'geomnodes' for grouping
//     defaultParams() : object cloned per instance,
//     inputs          : [{ name, type }],
//     outputs         : [{ name, type }],
//     eval(ctx, ins)  : returns a THREE.BufferGeometry
//   }
//
// CONSTRAINT (from the brief): pure native, three.js + React only — NO
// new npm packages, NO WASM. Every kind below produces a real geometry
// using three primitives + arithmetic, no stubs.
//
// All `eval()` implementations:
//   • are pure functions of `this.params` and the resolved input Map
//   • return a fresh BufferGeometry (non-indexed where convenient)
//   • never mutate input geometries (ensureNonIndexed() clones)
//   • never spawn anything in the scene — that's the build-mesh step

import * as THREE from 'three';
import {
  mergeGeometries,
  mergeVertices,
} from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ─── Shared helpers (kept local so geomtotal doesn't import from the
//     prior slice directories — the brief says "create NEW files only,
//     do NOT touch existing geomnodes/ or geomdeep/ directories"). ───
function ensureNonIndexed(geo) {
  if (!geo) return null;
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

function emptyGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  return g;
}

function toVec3(v, fallback) {
  if (Array.isArray(v) && v.length >= 3) return [+v[0] || 0, +v[1] || 0, +v[2] || 0];
  if (typeof v === 'number') return [v, v, v];
  return fallback ? fallback.slice() : [0, 0, 0];
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function bbox(geo) {
  geo.computeBoundingBox();
  return geo.boundingBox.clone();
}

// Mulberry32 — small, fast, deterministic PRNG; returns floats in [0,1).
function mulberry32(a) {
  let s = (a >>> 0) || 1;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

// Build a non-indexed BufferGeometry from a list of triangles.
// `tris` is a Float32Array of length triCount * 9, each triple = vertex.
function geoFromTris(tris) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(tris, 3));
  g.computeVertexNormals();
  return g;
}

// Build a Float32Array of N points (3-tuple) into a non-mesh
// "point cloud" BufferGeometry whose position count = N. We synthesise
// a trio of zero-area triangles per point so downstream nodes (which
// expect triangle data) still walk them safely. Each "tri" is the
// point repeated three times.
function pointsToGeo(points /* Array<[x,y,z]> */) {
  const N = points.length;
  if (N === 0) return emptyGeometry();
  const arr = new Float32Array(N * 9);
  for (let i = 0; i < N; i++) {
    const o = i * 9;
    const [x, y, z] = points[i];
    arr[o]     = x; arr[o + 1] = y; arr[o + 2] = z;
    arr[o + 3] = x; arr[o + 4] = y; arr[o + 5] = z;
    arr[o + 6] = x; arr[o + 7] = y; arr[o + 8] = z;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.computeVertexNormals();
  // Tag as point-cloud for introspection.
  g.userData = g.userData || {};
  g.userData.pointCloud = true;
  g.userData.pointCount = N;
  return g;
}

// Sample distinct points from a geometry (sub-sample if too many).
function distinctPoints(geo, cap = 1024) {
  const pos = geo && geo.attributes && geo.attributes.position;
  if (!pos || pos.count === 0) return [];
  const step = Math.max(1, Math.floor(pos.count / cap));
  const seen = new Set();
  const pts = [];
  for (let i = 0; i < pos.count && pts.length < cap; i += step) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x * 1000)}|${Math.round(y * 1000)}|${Math.round(z * 1000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pts.push([x, y, z]);
  }
  return pts;
}

// ─── Polyhedron half-data (Tetra / Octa / Dodec) ─────────────────────────
// Tetrahedron — four vertices, four triangles.
const TETRA_VERTS = [
  [1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1],
];
const TETRA_FACES = [
  [0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3],
];

// Octahedron — six vertices, eight triangles.
const OCTA_VERTS = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
const OCTA_FACES = [
  [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
  [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
];

// Dodecahedron — 20 vertices, 12 pentagonal faces (we triangulate via fan).
// phi = (1 + sqrt(5)) / 2 ≈ 1.6180339887
const PHI = (1 + Math.sqrt(5)) / 2;
const IPHI = 1 / PHI;
const DODEC_VERTS = [
  // (±1, ±1, ±1)
  [ 1,  1,  1], [ 1,  1, -1], [ 1, -1,  1], [ 1, -1, -1],
  [-1,  1,  1], [-1,  1, -1], [-1, -1,  1], [-1, -1, -1],
  // (0, ±1/φ, ±φ)
  [0,  IPHI,  PHI], [0,  IPHI, -PHI], [0, -IPHI,  PHI], [0, -IPHI, -PHI],
  // (±1/φ, ±φ, 0)
  [ IPHI,  PHI, 0], [ IPHI, -PHI, 0], [-IPHI,  PHI, 0], [-IPHI, -PHI, 0],
  // (±φ, 0, ±1/φ)
  [ PHI, 0,  IPHI], [ PHI, 0, -IPHI], [-PHI, 0,  IPHI], [-PHI, 0, -IPHI],
];
// 12 pentagonal faces (CCW outward). Source: standard regular dodec face list.
const DODEC_PENTAGONS = [
  [ 0,  8, 10,  2, 16],
  [ 0, 16, 17,  1, 12],
  [ 0, 12, 14,  4,  8],
  [ 1, 17,  3, 11,  9],
  [ 1,  9,  5, 14, 12],
  [ 2, 10,  6, 15, 13],
  [ 2, 13,  3, 17, 16],
  [ 3, 13, 15,  7, 11],
  [ 4, 14,  5, 19, 18],
  [ 4, 18,  6, 10,  8],
  [ 5,  9, 11,  7, 19],
  [ 6, 18, 19,  7, 15],
];

function polyhedronGeo(verts, faces, radius) {
  // faces : each a triangle (length 3) OR a polygon (length >=3) fanned
  // from index 0.
  const tris = [];
  for (const f of faces) {
    if (f.length === 3) {
      tris.push([f[0], f[1], f[2]]);
    } else {
      for (let k = 1; k < f.length - 1; k++) tris.push([f[0], f[k], f[k + 1]]);
    }
  }
  const out = new Float32Array(tris.length * 9);
  // Normalize each vertex onto sphere of `radius`.
  const norm = verts.map((v) => {
    const L = Math.hypot(v[0], v[1], v[2]) || 1;
    return [v[0] / L * radius, v[1] / L * radius, v[2] / L * radius];
  });
  let o = 0;
  for (const t of tris) {
    for (const idx of t) {
      const v = norm[idx];
      out[o++] = v[0]; out[o++] = v[1]; out[o++] = v[2];
    }
  }
  return geoFromTris(out);
}

// ─── 30 new node kinds ───────────────────────────────────────────────────
export const TOTAL_NODE_KINDS = {

  // ═══════════════════════════════════════════════════════════════════════
  // PRIMITIVE VARIANTS (8): Tetra/Octa/Dodec/Capsule/RingTorus/CylOpenEnd/
  // Frustum/Pyramid
  // ═══════════════════════════════════════════════════════════════════════

  // 1. Tetrahedron — 4 triangle faces, radius parameter.
  tetrahedron: {
    title: 'Tetrahedron',
    category: 'geomnodes',
    defaultParams: () => ({ radius: 0.6 }),
    inputs: [],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(/* ctx, ins */) {
      const r = Math.max(1e-4, +this.params.radius || 0.6);
      return polyhedronGeo(TETRA_VERTS, TETRA_FACES, r);
    },
  },

  // 2. Octahedron — 8 triangle faces.
  octahedron: {
    title: 'Octahedron',
    category: 'geomnodes',
    defaultParams: () => ({ radius: 0.6 }),
    inputs: [],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(/* ctx, ins */) {
      const r = Math.max(1e-4, +this.params.radius || 0.6);
      return polyhedronGeo(OCTA_VERTS, OCTA_FACES, r);
    },
  },

  // 3. Dodecahedron — 12 pentagonal faces (fan-triangulated → 36 tris).
  dodecahedron: {
    title: 'Dodecahedron',
    category: 'geomnodes',
    defaultParams: () => ({ radius: 0.7 }),
    inputs: [],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(/* ctx, ins */) {
      const r = Math.max(1e-4, +this.params.radius || 0.7);
      return polyhedronGeo(DODEC_VERTS, DODEC_PENTAGONS, r);
    },
  },

  // 4. Capsule — cylinder with hemispherical caps. Uses three's
  //              CapsuleGeometry (added in r140+, included in 0.181).
  capsule: {
    title: 'Capsule',
    category: 'geomnodes',
    defaultParams: () => ({ radius: 0.3, length: 0.8, capSegments: 8, radialSegments: 16 }),
    inputs: [],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(/* ctx, ins */) {
      const p = this.params || {};
      const r = Math.max(1e-3, +p.radius || 0.3);
      const len = Math.max(0, +p.length || 0.8);
      const cap = clamp(Math.floor(+p.capSegments || 8), 1, 32);
      const rad = clamp(Math.floor(+p.radialSegments || 16), 3, 64);
      return ensureNonIndexed(new THREE.CapsuleGeometry(r, len, cap, rad));
    },
  },

  // 5. Ring Torus — explicit major (ring) + minor (tube) parameters.
  //                 Distinct param surface from the slice-684 'torus' primitive.
  ringTorus: {
    title: 'Ring Torus',
    category: 'geomnodes',
    defaultParams: () => ({
      majorRadius: 0.7, minorRadius: 0.18,
      majorSegments: 32, minorSegments: 16,
      arc: Math.PI * 2,
    }),
    inputs: [],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(/* ctx, ins */) {
      const p = this.params || {};
      const R = Math.max(1e-3, +p.majorRadius || 0.7);
      const r = Math.max(1e-3, +p.minorRadius || 0.18);
      const mSeg = clamp(Math.floor(+p.majorSegments || 32), 4, 128);
      const nSeg = clamp(Math.floor(+p.minorSegments || 16), 3, 64);
      const arc = Math.max(0.01, +p.arc || Math.PI * 2);
      return ensureNonIndexed(new THREE.TorusGeometry(R, r, nSeg, mSeg, arc));
    },
  },

  // 6. Cylinder Open Ended — tube with no top / bottom caps.
  cylinderOpenEnded: {
    title: 'Cylinder Open Ended',
    category: 'geomnodes',
    defaultParams: () => ({ radius: 0.5, height: 1.0, radialSegments: 24, heightSegments: 1 }),
    inputs: [],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(/* ctx, ins */) {
      const p = this.params || {};
      const r = Math.max(1e-3, +p.radius || 0.5);
      const h = Math.max(1e-3, +p.height || 1.0);
      const rad = clamp(Math.floor(+p.radialSegments || 24), 3, 128);
      const hSeg = clamp(Math.floor(+p.heightSegments || 1), 1, 64);
      return ensureNonIndexed(new THREE.CylinderGeometry(r, r, h, rad, hSeg, true));
    },
  },

  // 7. Frustum — truncated cone (different top/bottom radii). Closed.
  frustum: {
    title: 'Frustum',
    category: 'geomnodes',
    defaultParams: () => ({ topRadius: 0.25, bottomRadius: 0.6, height: 1.0, radialSegments: 24 }),
    inputs: [],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(/* ctx, ins */) {
      const p = this.params || {};
      const rt = Math.max(0, +p.topRadius || 0.25);
      const rb = Math.max(1e-3, +p.bottomRadius || 0.6);
      const h = Math.max(1e-3, +p.height || 1.0);
      const rad = clamp(Math.floor(+p.radialSegments || 24), 3, 128);
      return ensureNonIndexed(new THREE.CylinderGeometry(rt, rb, h, rad, 1, false));
    },
  },

  // 8. Pyramid — square base with apex above. Built as 4 lateral tris +
  //              2 base tris. `sides` controls the base polygon count
  //              (3=tetra-like, 4=square pyramid, …).
  pyramid: {
    title: 'Pyramid',
    category: 'geomnodes',
    defaultParams: () => ({ baseRadius: 0.6, height: 0.9, sides: 4 }),
    inputs: [],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(/* ctx, ins */) {
      const p = this.params || {};
      const r = Math.max(1e-3, +p.baseRadius || 0.6);
      const h = Math.max(1e-3, +p.height || 0.9);
      const n = clamp(Math.floor(+p.sides || 4), 3, 64);
      // ConeGeometry built with `radialSegments = n` gives a perfect
      // n-sided pyramid: lateral faces + capped base.
      return ensureNonIndexed(new THREE.ConeGeometry(r, h, n, 1, false));
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CURVES (4): Spiral / Helix / LineSegment / ArcCircle
  // ═══════════════════════════════════════════════════════════════════════

  // 9. Spiral — Archimedean spiral in the XY plane, rendered as a Tube.
  //             r(θ) = a + b·θ
  spiral: {
    title: 'Spiral',
    category: 'geomnodes',
    defaultParams: () => ({
      turns: 3, a: 0.0, b: 0.12,
      tubeRadius: 0.04, samples: 128, radialSegments: 6,
    }),
    inputs: [],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(/* ctx, ins */) {
      const p = this.params || {};
      const turns = Math.max(0.1, +p.turns || 3);
      const a = +p.a || 0;
      const b = +p.b || 0.12;
      const tubeR = Math.max(1e-4, +p.tubeRadius || 0.04);
      const N = clamp(Math.floor(+p.samples || 128), 8, 1024);
      const rad = clamp(Math.floor(+p.radialSegments || 6), 3, 32);
      const pts = [];
      const thetaMax = turns * Math.PI * 2;
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const theta = t * thetaMax;
        const r = a + b * theta;
        pts.push(new THREE.Vector3(Math.cos(theta) * r, Math.sin(theta) * r, 0));
      }
      const curve = new THREE.CatmullRomCurve3(pts, false);
      return ensureNonIndexed(new THREE.TubeGeometry(curve, N - 1, tubeR, rad, false));
    },
  },

  // 10. Helix — 3D helix along Y axis with parameter-driven radius / pitch.
  helix: {
    title: 'Helix',
    category: 'geomnodes',
    defaultParams: () => ({
      radius: 0.4, pitch: 0.25, turns: 4,
      tubeRadius: 0.04, samples: 128, radialSegments: 6,
    }),
    inputs: [],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(/* ctx, ins */) {
      const p = this.params || {};
      const r = Math.max(1e-3, +p.radius || 0.4);
      const pitch = +p.pitch || 0.25;
      const turns = Math.max(0.1, +p.turns || 4);
      const tubeR = Math.max(1e-4, +p.tubeRadius || 0.04);
      const N = clamp(Math.floor(+p.samples || 128), 8, 1024);
      const rad = clamp(Math.floor(+p.radialSegments || 6), 3, 32);
      const pts = [];
      const thetaMax = turns * Math.PI * 2;
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const theta = t * thetaMax;
        pts.push(new THREE.Vector3(
          Math.cos(theta) * r,
          (t - 0.5) * pitch * turns * Math.PI * 2,
          Math.sin(theta) * r,
        ));
      }
      const curve = new THREE.CatmullRomCurve3(pts, false);
      return ensureNonIndexed(new THREE.TubeGeometry(curve, N - 1, tubeR, rad, false));
    },
  },

  // 11. Line Segment — single straight tube from `from` to `to`.
  lineSegment: {
    title: 'Line Segment',
    category: 'geomnodes',
    defaultParams: () => ({
      from: [-0.8, 0, 0], to: [0.8, 0, 0],
      tubeRadius: 0.04, radialSegments: 8,
    }),
    inputs: [],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(/* ctx, ins */) {
      const p = this.params || {};
      const a = toVec3(p.from, [-0.8, 0, 0]);
      const b = toVec3(p.to, [0.8, 0, 0]);
      const va = new THREE.Vector3().fromArray(a);
      const vb = new THREE.Vector3().fromArray(b);
      // Pad with a midpoint so CatmullRomCurve3 has > 2 control points.
      const mid = va.clone().add(vb).multiplyScalar(0.5);
      const curve = new THREE.CatmullRomCurve3([va, mid, vb], false);
      const tubeR = Math.max(1e-4, +p.tubeRadius || 0.04);
      const rad = clamp(Math.floor(+p.radialSegments || 8), 3, 32);
      return ensureNonIndexed(new THREE.TubeGeometry(curve, 12, tubeR, rad, false));
    },
  },

  // 12. Arc Circle — partial arc in XY plane, tube along the curve.
  arcCircle: {
    title: 'Arc Circle',
    category: 'geomnodes',
    defaultParams: () => ({
      radius: 0.6, startAngle: 0, endAngle: Math.PI,
      tubeRadius: 0.04, samples: 48, radialSegments: 8,
    }),
    inputs: [],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(/* ctx, ins */) {
      const p = this.params || {};
      const r = Math.max(1e-3, +p.radius || 0.6);
      const s = +p.startAngle || 0;
      const e = (typeof p.endAngle === 'number') ? p.endAngle : Math.PI;
      const N = clamp(Math.floor(+p.samples || 48), 4, 512);
      const tubeR = Math.max(1e-4, +p.tubeRadius || 0.04);
      const rad = clamp(Math.floor(+p.radialSegments || 8), 3, 32);
      const pts = [];
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const theta = s + (e - s) * t;
        pts.push(new THREE.Vector3(Math.cos(theta) * r, Math.sin(theta) * r, 0));
      }
      const curve = new THREE.CatmullRomCurve3(pts, false);
      return ensureNonIndexed(new THREE.TubeGeometry(curve, N - 1, tubeR, rad, false));
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ATTRIBUTE MATH (6): SetPositionAttr / CapturePositionAttr / VectorMath /
  // DotProduct / Length / MapRange
  // ═══════════════════════════════════════════════════════════════════════

  // 13. Set Position Attr — write a named per-vertex attribute storing
  //                          the current position. Useful for downstream
  //                          nodes that read from `capturedPos`.
  setPositionAttr: {
    title: 'Set Position Attr',
    category: 'geomnodes',
    defaultParams: () => ({ attrName: 'capturedPos' }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const name = String(this.params.attrName || 'capturedPos');
      const pos = g.attributes.position;
      // Copy the position array verbatim into a new attribute.
      const arr = new Float32Array(pos.array.length);
      arr.set(pos.array);
      g.setAttribute(name, new THREE.BufferAttribute(arr, 3));
      return g;
    },
  },

  // 14. Capture Position Attr — read a named attribute (default
  //                              'capturedPos') back into the position
  //                              array. If the attribute is missing, this
  //                              is a passthrough.
  capturePositionAttr: {
    title: 'Capture Position Attr',
    category: 'geomnodes',
    defaultParams: () => ({ attrName: 'capturedPos' }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const name = String(this.params.attrName || 'capturedPos');
      const cap = g.attributes[name];
      const pos = g.attributes.position;
      if (cap && cap.array && cap.array.length === pos.array.length) {
        pos.array.set(cap.array);
        pos.needsUpdate = true;
        g.computeVertexNormals();
      }
      return g;
    },
  },

  // 15. Vector Math — element-wise vector op applied to every vertex
  //                    against a constant `b` vector. ops: add / sub /
  //                    cross / normalize (unary; ignores b).
  vectorMath: {
    title: 'Vector Math',
    category: 'geomnodes',
    defaultParams: () => ({ op: 'add', b: [0.1, 0.0, 0.0] }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const op = String(this.params.op || 'add');
      const b = toVec3(this.params.b, [0, 0, 0]);
      const pos = g.attributes.position;
      const arr = pos.array;
      const n = pos.count;
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        const x = arr[o], y = arr[o + 1], z = arr[o + 2];
        let nx = x, ny = y, nz = z;
        if (op === 'add') { nx = x + b[0]; ny = y + b[1]; nz = z + b[2]; }
        else if (op === 'sub') { nx = x - b[0]; ny = y - b[1]; nz = z - b[2]; }
        else if (op === 'cross') {
          // a × b
          nx = y * b[2] - z * b[1];
          ny = z * b[0] - x * b[2];
          nz = x * b[1] - y * b[0];
        } else if (op === 'normalize') {
          const L = Math.hypot(x, y, z) || 1;
          nx = x / L; ny = y / L; nz = z / L;
        }
        arr[o] = nx; arr[o + 1] = ny; arr[o + 2] = nz;
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
      return g;
    },
  },

  // 16. Dot Product — compute per-vertex dot(position, b) and write it
  //                    into a named scalar attribute (default 'dot').
  //                    Geometry passes through unchanged.
  dotProduct: {
    title: 'Dot Product',
    category: 'geomnodes',
    defaultParams: () => ({ b: [0, 1, 0], attrName: 'dot' }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const b = toVec3(this.params.b, [0, 1, 0]);
      const name = String(this.params.attrName || 'dot');
      const pos = g.attributes.position;
      const n = pos.count;
      const arr = new Float32Array(n);
      const parr = pos.array;
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        arr[i] = parr[o] * b[0] + parr[o + 1] * b[1] + parr[o + 2] * b[2];
      }
      g.setAttribute(name, new THREE.BufferAttribute(arr, 1));
      return g;
    },
  },

  // 17. Length — write |position| per vertex into a named scalar attribute.
  length: {
    title: 'Length',
    category: 'geomnodes',
    defaultParams: () => ({ attrName: 'length' }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const name = String(this.params.attrName || 'length');
      const pos = g.attributes.position;
      const n = pos.count;
      const arr = new Float32Array(n);
      const parr = pos.array;
      for (let i = 0; i < n; i++) {
        const o = i * 3;
        arr[i] = Math.hypot(parr[o], parr[o + 1], parr[o + 2]);
      }
      g.setAttribute(name, new THREE.BufferAttribute(arr, 1));
      return g;
    },
  },

  // 18. Map Range — remap a named scalar attribute from [fromMin,fromMax]
  //                  to [toMin,toMax] in-place. If the attribute doesn't
  //                  exist, falls back to remapping each axis of position.
  mapRange: {
    title: 'Map Range',
    category: 'geomnodes',
    defaultParams: () => ({
      attrName: 'length',
      fromMin: 0, fromMax: 1,
      toMin: 0,  toMax: 1,
      clamp: true,
    }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const name = String(this.params.attrName || 'length');
      const fmin = +this.params.fromMin || 0;
      const fmax = (typeof this.params.fromMax === 'number') ? this.params.fromMax : 1;
      const tmin = +this.params.toMin || 0;
      const tmax = (typeof this.params.toMax === 'number') ? this.params.toMax : 1;
      const doClamp = !!this.params.clamp;
      const span = (fmax - fmin) || 1;
      const remap = (v) => {
        let t = (v - fmin) / span;
        if (doClamp) t = clamp(t, 0, 1);
        return tmin + t * (tmax - tmin);
      };
      const attr = g.attributes[name];
      if (attr && attr.itemSize === 1) {
        const a = attr.array;
        for (let i = 0; i < a.length; i++) a[i] = remap(a[i]);
        attr.needsUpdate = true;
      } else {
        // Fall back: remap each axis of position.
        const pos = g.attributes.position;
        const a = pos.array;
        for (let i = 0; i < a.length; i++) a[i] = remap(a[i]);
        pos.needsUpdate = true;
        g.computeVertexNormals();
      }
      return g;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // TOPOLOGY (6): EdgeSplitByAngle / MergeByDistance / ExtrudeAlongNormal /
  // InsetIndividual / FaceWeightedNormal / RecalculateNormals
  // ═══════════════════════════════════════════════════════════════════════

  // 19. Edge Split By Angle — split adjacent faces whose dihedral angle
  //                            exceeds a threshold so they no longer share
  //                            verts (each face becomes flat-shaded
  //                            independently). Threshold is in degrees.
  //                            Implementation: convert to non-indexed,
  //                            then for each triangle whose normal differs
  //                            from neighbours by >threshold, keep the
  //                            tri verts unmerged (no welding). The simple
  //                            non-indexed form already achieves this for
  //                            ALL angles → we measure and ONLY weld pairs
  //                            below threshold via a custom path.
  edgeSplitByAngle: {
    title: 'Edge Split By Angle',
    category: 'geomnodes',
    defaultParams: () => ({ angleDeg: 30 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const flat = ensureNonIndexed(src);
      const angle = Math.max(0, Math.min(180, +this.params.angleDeg || 30));
      // Strategy: weld vertices, compute per-vertex normal as area-weighted
      // average of adjacent faces, then for each triangle if all 3 of its
      // verts' smooth normals are within `angle` of the face normal, keep
      // smooth; otherwise split (re-emit the tri unmerged).
      const welded = mergeVertices(flat, 1e-5);
      if (!welded.index) return flat;
      const idx = welded.index.array;
      const wpos = welded.attributes.position;
      const triCount = idx.length / 3;

      // Compute per-face normals.
      const fn = new Float32Array(triCount * 3);
      const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
      const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
      for (let t = 0; t < triCount; t++) {
        const ia = idx[t * 3], ib = idx[t * 3 + 1], ic = idx[t * 3 + 2];
        va.fromArray(wpos.array, ia * 3);
        vb.fromArray(wpos.array, ib * 3);
        vc.fromArray(wpos.array, ic * 3);
        e1.subVectors(vb, va); e2.subVectors(vc, va);
        nrm.crossVectors(e1, e2).normalize();
        fn[t * 3]     = nrm.x;
        fn[t * 3 + 1] = nrm.y;
        fn[t * 3 + 2] = nrm.z;
      }

      // Per-vertex smooth normal (area-weighted avg of adjacent face normals).
      const nVert = wpos.count;
      const sn = new Float32Array(nVert * 3);
      for (let t = 0; t < triCount; t++) {
        for (let k = 0; k < 3; k++) {
          const v = idx[t * 3 + k];
          sn[v * 3]     += fn[t * 3];
          sn[v * 3 + 1] += fn[t * 3 + 1];
          sn[v * 3 + 2] += fn[t * 3 + 2];
        }
      }
      for (let i = 0; i < nVert; i++) {
        const o = i * 3;
        const L = Math.hypot(sn[o], sn[o + 1], sn[o + 2]) || 1;
        sn[o] /= L; sn[o + 1] /= L; sn[o + 2] /= L;
      }

      // Cosine threshold (angle of difference allowed before splitting).
      const cosThresh = Math.cos(angle * Math.PI / 180);

      // Emit final geometry: per triangle decide split-or-smooth.
      const out = new Float32Array(triCount * 9);
      const ono = new Float32Array(triCount * 9);
      let o = 0;
      for (let t = 0; t < triCount; t++) {
        const ia = idx[t * 3], ib = idx[t * 3 + 1], ic = idx[t * 3 + 2];
        const fx = fn[t * 3], fy = fn[t * 3 + 1], fz = fn[t * 3 + 2];
        // Check if any vert's smooth normal is too far from face normal.
        let split = false;
        for (const vi of [ia, ib, ic]) {
          const vx = sn[vi * 3], vy = sn[vi * 3 + 1], vz = sn[vi * 3 + 2];
          if (fx * vx + fy * vy + fz * vz < cosThresh) { split = true; break; }
        }
        // Position
        for (const vi of [ia, ib, ic]) {
          out[o]     = wpos.array[vi * 3];
          out[o + 1] = wpos.array[vi * 3 + 1];
          out[o + 2] = wpos.array[vi * 3 + 2];
          if (split) {
            ono[o] = fx; ono[o + 1] = fy; ono[o + 2] = fz;
          } else {
            const vx = sn[vi * 3], vy = sn[vi * 3 + 1], vz = sn[vi * 3 + 2];
            ono[o] = vx; ono[o + 1] = vy; ono[o + 2] = vz;
          }
          o += 3;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(out, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(ono, 3));
      return g;
    },
  },

  // 20. Merge By Distance — weld coincident verts within `distance`
  //                          (BufferGeometryUtils.mergeVertices). Real,
  //                          not approximated.
  mergeByDistance: {
    title: 'Merge By Distance',
    category: 'geomnodes',
    defaultParams: () => ({ distance: 0.001 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const d = Math.max(1e-7, +this.params.distance || 0.001);
      try {
        const merged = mergeVertices(ensureNonIndexed(src), d);
        merged.computeVertexNormals();
        return merged;
      } catch (_) {
        return ensureNonIndexed(src);
      }
    },
  },

  // 21. Extrude Along Normal — full-mesh extrusion: every vertex is
  //                              pushed along its smooth vertex normal by
  //                              `distance`. Inflates / shrinks the whole
  //                              mesh. (Unlike per-face extrusion, this
  //                              is the standard "displace along normal"
  //                              modifier — distinct from geomnodes'
  //                              `Transform` which is global TRS.)
  extrudeAlongNormal: {
    title: 'Extrude Along Normal',
    category: 'geomnodes',
    defaultParams: () => ({ distance: 0.1 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      // Use smooth normals so the extrusion follows the underlying shape.
      const welded = mergeVertices(g, 1e-5);
      welded.computeVertexNormals();
      const d = +this.params.distance || 0.1;
      const pos = welded.attributes.position;
      const nor = welded.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        pos.setXYZ(
          i,
          pos.getX(i) + nor.getX(i) * d,
          pos.getY(i) + nor.getY(i) * d,
          pos.getZ(i) + nor.getZ(i) * d,
        );
      }
      pos.needsUpdate = true;
      welded.computeVertexNormals();
      return welded;
    },
  },

  // 22. Inset Individual — for each triangle, shrink it toward its centroid
  //                         by `amount` ∈ [0..1) — 0 = no inset, 1 = collapse
  //                         to centroid. Produces the classic "inset face"
  //                         look on every triangle independently.
  insetIndividual: {
    title: 'Inset Individual',
    category: 'geomnodes',
    defaultParams: () => ({ amount: 0.2 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const k = clamp(+this.params.amount || 0.2, 0, 0.999);
      const pos = g.attributes.position;
      const arr = pos.array;
      const tris = pos.count / 3;
      for (let t = 0; t < tris; t++) {
        const o = t * 9;
        const cx = (arr[o] + arr[o + 3] + arr[o + 6]) / 3;
        const cy = (arr[o + 1] + arr[o + 4] + arr[o + 7]) / 3;
        const cz = (arr[o + 2] + arr[o + 5] + arr[o + 8]) / 3;
        for (let v = 0; v < 3; v++) {
          const i = o + v * 3;
          arr[i]     = cx + (arr[i]     - cx) * (1 - k);
          arr[i + 1] = cy + (arr[i + 1] - cy) * (1 - k);
          arr[i + 2] = cz + (arr[i + 2] - cz) * (1 - k);
        }
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
      return g;
    },
  },

  // 23. Face Weighted Normal — write per-vertex normals weighted by the
  //                             AREA of adjacent faces (instead of uniform
  //                             average). Produces smoother shading on
  //                             meshes with mixed triangle sizes.
  faceWeightedNormal: {
    title: 'Face Weighted Normal',
    category: 'geomnodes',
    defaultParams: () => ({}),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const welded = mergeVertices(ensureNonIndexed(src), 1e-5);
      if (!welded.index) return ensureNonIndexed(src);
      const idx = welded.index.array;
      const pos = welded.attributes.position;
      const nVert = pos.count;
      const sn = new Float32Array(nVert * 3);
      const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
      const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), n = new THREE.Vector3();
      for (let t = 0; t < idx.length; t += 3) {
        const ia = idx[t], ib = idx[t + 1], ic = idx[t + 2];
        va.fromArray(pos.array, ia * 3);
        vb.fromArray(pos.array, ib * 3);
        vc.fromArray(pos.array, ic * 3);
        e1.subVectors(vb, va); e2.subVectors(vc, va);
        n.crossVectors(e1, e2);
        // Magnitude of cross = 2 * area. We keep it un-normalized so the
        // accumulation IS area-weighted.
        for (const vi of [ia, ib, ic]) {
          sn[vi * 3]     += n.x;
          sn[vi * 3 + 1] += n.y;
          sn[vi * 3 + 2] += n.z;
        }
      }
      // Normalize.
      for (let i = 0; i < nVert; i++) {
        const o = i * 3;
        const L = Math.hypot(sn[o], sn[o + 1], sn[o + 2]) || 1;
        sn[o] /= L; sn[o + 1] /= L; sn[o + 2] /= L;
      }
      welded.setAttribute('normal', new THREE.BufferAttribute(sn, 3));
      return welded;
    },
  },

  // 24. Recalculate Normals — re-run computeVertexNormals on a fresh copy.
  //                            Handy after vertex-position edits (Wrangle,
  //                            Noise Displace, …) that left stale normals.
  recalculateNormals: {
    title: 'Recalculate Normals',
    category: 'geomnodes',
    defaultParams: () => ({}),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      g.computeVertexNormals();
      return g;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // DISTRIBUTION (3): PointsOnFaces / PoissonDisk / GridPoints
  // ═══════════════════════════════════════════════════════════════════════

  // 25. Points On Faces — N random points scattered on the input mesh
  //                        surface (triangle-area-weighted). Output is a
  //                        point-cloud geometry (each "vertex" is a 3-tri
  //                        degenerate placeholder so downstream nodes
  //                        can sample positions).
  pointsOnFaces: {
    title: 'Points On Faces',
    category: 'geomnodes',
    defaultParams: () => ({ count: 64, seed: 1 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const pos = g.attributes.position;
      if (!pos || pos.count < 3) return emptyGeometry();
      const triCount = pos.count / 3;
      // Area-weighted cumulative table.
      const areas = new Float64Array(triCount);
      let total = 0;
      const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
      const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
      for (let t = 0; t < triCount; t++) {
        v0.fromArray(pos.array, t * 9);
        v1.fromArray(pos.array, t * 9 + 3);
        v2.fromArray(pos.array, t * 9 + 6);
        e1.subVectors(v1, v0); e2.subVectors(v2, v0);
        nrm.crossVectors(e1, e2);
        total += nrm.length() * 0.5;
        areas[t] = total;
      }
      if (total <= 0) return emptyGeometry();

      const N = clamp(Math.floor(+this.params.count || 64), 1, 4096);
      const seed = (Number(this.params.seed) | 0) || 1;
      const rng = mulberry32(seed * 2731);
      const out = [];
      for (let s = 0; s < N; s++) {
        const r = rng() * total;
        let lo = 0, hi = triCount - 1;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (areas[mid] < r) lo = mid + 1; else hi = mid;
        }
        const t = lo;
        let u = rng(), w = rng();
        if (u + w > 1) { u = 1 - u; w = 1 - w; }
        const vv = 1 - u - w;
        v0.fromArray(pos.array, t * 9);
        v1.fromArray(pos.array, t * 9 + 3);
        v2.fromArray(pos.array, t * 9 + 6);
        out.push([
          v0.x * vv + v1.x * u + v2.x * w,
          v0.y * vv + v1.y * u + v2.y * w,
          v0.z * vv + v1.z * u + v2.z * w,
        ]);
      }
      return pointsToGeo(out);
    },
  },

  // 26. Poisson Disk — Bridson-style blue-noise distribution inside the
  //                     input's bounding box. Pure-JS implementation
  //                     (no extra deps).
  poissonDisk: {
    title: 'Poisson Disk',
    category: 'geomnodes',
    defaultParams: () => ({ minDistance: 0.15, maxSamples: 256, k: 30, seed: 1 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const bb = bbox(g);
      const sx = Math.max(1e-3, bb.max.x - bb.min.x);
      const sy = Math.max(1e-3, bb.max.y - bb.min.y);
      const sz = Math.max(1e-3, bb.max.z - bb.min.z);

      const r = Math.max(1e-3, +this.params.minDistance || 0.15);
      const cap = clamp(Math.floor(+this.params.maxSamples || 256), 1, 4096);
      const k = clamp(Math.floor(+this.params.k || 30), 1, 60);
      const seed = (Number(this.params.seed) | 0) || 1;
      const rng = mulberry32(seed * 6577);

      // 3D grid for fast neighbour rejection. Cell size = r / sqrt(3).
      const cell = r / Math.sqrt(3);
      const gx = Math.max(1, Math.ceil(sx / cell));
      const gy = Math.max(1, Math.ceil(sy / cell));
      const gz = Math.max(1, Math.ceil(sz / cell));
      const grid = new Array(gx * gy * gz).fill(-1);
      const points = []; // each [x,y,z]
      const active = [];

      const idxOf = (px, py, pz) => {
        const cx = Math.min(gx - 1, Math.floor((px - bb.min.x) / cell));
        const cy = Math.min(gy - 1, Math.floor((py - bb.min.y) / cell));
        const cz = Math.min(gz - 1, Math.floor((pz - bb.min.z) / cell));
        return cx + cy * gx + cz * gx * gy;
      };

      const tooClose = (px, py, pz) => {
        const cx = Math.min(gx - 1, Math.floor((px - bb.min.x) / cell));
        const cy = Math.min(gy - 1, Math.floor((py - bb.min.y) / cell));
        const cz = Math.min(gz - 1, Math.floor((pz - bb.min.z) / cell));
        for (let z = Math.max(0, cz - 2); z <= Math.min(gz - 1, cz + 2); z++) {
          for (let y = Math.max(0, cy - 2); y <= Math.min(gy - 1, cy + 2); y++) {
            for (let x = Math.max(0, cx - 2); x <= Math.min(gx - 1, cx + 2); x++) {
              const id = grid[x + y * gx + z * gx * gy];
              if (id < 0) continue;
              const p = points[id];
              const dx = p[0] - px, dy = p[1] - py, dz = p[2] - pz;
              if (dx * dx + dy * dy + dz * dz < r * r) return true;
            }
          }
        }
        return false;
      };

      // Seed first point in centre of bbox.
      const seedPt = [bb.min.x + sx * 0.5, bb.min.y + sy * 0.5, bb.min.z + sz * 0.5];
      points.push(seedPt);
      grid[idxOf(seedPt[0], seedPt[1], seedPt[2])] = 0;
      active.push(0);

      while (active.length > 0 && points.length < cap) {
        // Random active point.
        const aIdx = Math.floor(rng() * active.length);
        const pid = active[aIdx];
        const base = points[pid];
        let found = false;
        for (let i = 0; i < k && points.length < cap; i++) {
          // Random point in spherical shell [r, 2r].
          const theta = rng() * Math.PI * 2;
          const phi = Math.acos(2 * rng() - 1);
          const radius = r + rng() * r;
          const dx = radius * Math.sin(phi) * Math.cos(theta);
          const dy = radius * Math.sin(phi) * Math.sin(theta);
          const dz = radius * Math.cos(phi);
          const nx = base[0] + dx, ny = base[1] + dy, nz = base[2] + dz;
          if (nx < bb.min.x || nx > bb.max.x) continue;
          if (ny < bb.min.y || ny > bb.max.y) continue;
          if (nz < bb.min.z || nz > bb.max.z) continue;
          if (tooClose(nx, ny, nz)) continue;
          const id = points.length;
          points.push([nx, ny, nz]);
          grid[idxOf(nx, ny, nz)] = id;
          active.push(id);
          found = true;
          break;
        }
        if (!found) {
          // Remove from active list.
          active[aIdx] = active[active.length - 1];
          active.pop();
        }
      }
      return pointsToGeo(points);
    },
  },

  // 27. Grid Points — regular nx × ny × nz lattice inside the input's
  //                    bounding box (or a unit box if no input).
  gridPoints: {
    title: 'Grid Points',
    category: 'geomnodes',
    defaultParams: () => ({ nx: 6, ny: 6, nz: 6 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      let minV, maxV;
      if (src) {
        const g = ensureNonIndexed(src);
        const bb = bbox(g);
        minV = bb.min; maxV = bb.max;
      } else {
        minV = new THREE.Vector3(-0.5, -0.5, -0.5);
        maxV = new THREE.Vector3(0.5, 0.5, 0.5);
      }
      const nx = clamp(Math.floor(+this.params.nx || 6), 1, 64);
      const ny = clamp(Math.floor(+this.params.ny || 6), 1, 64);
      const nz = clamp(Math.floor(+this.params.nz || 6), 1, 64);
      const dx = nx > 1 ? (maxV.x - minV.x) / (nx - 1) : 0;
      const dy = ny > 1 ? (maxV.y - minV.y) / (ny - 1) : 0;
      const dz = nz > 1 ? (maxV.z - minV.z) / (nz - 1) : 0;
      const pts = [];
      for (let k = 0; k < nz; k++) {
        for (let j = 0; j < ny; j++) {
          for (let i = 0; i < nx; i++) {
            pts.push([
              nx > 1 ? minV.x + i * dx : (minV.x + maxV.x) / 2,
              ny > 1 ? minV.y + j * dy : (minV.y + maxV.y) / 2,
              nz > 1 ? minV.z + k * dz : (minV.z + maxV.z) / 2,
            ]);
          }
        }
      }
      return pointsToGeo(pts);
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // SAMPLING / FILTERING (3): SampleNearest / GreaterThan / MaskExtract
  // ═══════════════════════════════════════════════════════════════════════

  // 28. Sample Nearest — for each vertex of A, find the closest point on
  //                       B and move A's vertex to that location. Pure
  //                       brute-force closest-vertex search (no kd-tree
  //                       to honour the "no new deps" rule). Capped at
  //                       a sane work budget.
  sampleNearest: {
    title: 'Sample Nearest',
    category: 'geomnodes',
    defaultParams: () => ({ blend: 1.0 }),
    inputs: [
      { name: 'A', type: 'geometry' },
      { name: 'B', type: 'geometry' },
    ],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const a = ins.get('A');
      const b = ins.get('B');
      if (!a || !b) return emptyGeometry();
      const A = ensureNonIndexed(a);
      const B = ensureNonIndexed(b);
      const ap = A.attributes.position;
      const bp = B.attributes.position;
      if (!ap || !bp || ap.count === 0 || bp.count === 0) return A;
      const blend = clamp(+this.params.blend || 1, 0, 1);

      // Cap to prevent O(A·B) blow-up. Sub-sample B if it's huge.
      const bCap = 4096;
      let bArr = bp.array;
      let bCount = bp.count;
      if (bp.count > bCap) {
        const step = Math.max(1, Math.floor(bp.count / bCap));
        const cap = Math.floor(bp.count / step);
        const sub = new Float32Array(cap * 3);
        for (let i = 0; i < cap; i++) {
          sub[i * 3]     = bp.array[i * step * 3];
          sub[i * 3 + 1] = bp.array[i * step * 3 + 1];
          sub[i * 3 + 2] = bp.array[i * step * 3 + 2];
        }
        bArr = sub;
        bCount = cap;
      }

      const arr = ap.array;
      for (let i = 0; i < ap.count; i++) {
        const o = i * 3;
        const px = arr[o], py = arr[o + 1], pz = arr[o + 2];
        let best = Infinity, bx = px, by = py, bz = pz;
        for (let j = 0; j < bCount; j++) {
          const jo = j * 3;
          const dx = bArr[jo] - px, dy = bArr[jo + 1] - py, dz = bArr[jo + 2] - pz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < best) {
            best = d2;
            bx = bArr[jo]; by = bArr[jo + 1]; bz = bArr[jo + 2];
          }
        }
        arr[o]     = px + (bx - px) * blend;
        arr[o + 1] = py + (by - py) * blend;
        arr[o + 2] = pz + (bz - pz) * blend;
      }
      ap.needsUpdate = true;
      A.computeVertexNormals();
      return A;
    },
  },

  // 29. Greater Than — write a per-vertex BOOLEAN (0/1) attribute that
  //                     is 1 iff the named scalar attribute > threshold.
  //                     If the named attribute is missing, fall back to
  //                     position.y > threshold.
  greaterThan: {
    title: 'Greater Than',
    category: 'geomnodes',
    defaultParams: () => ({ attrName: 'length', threshold: 0.5, outAttr: 'mask' }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const name = String(this.params.attrName || 'length');
      const out = String(this.params.outAttr || 'mask');
      const thr = +this.params.threshold || 0;
      const attr = g.attributes[name];
      const pos = g.attributes.position;
      const n = pos.count;
      const arr = new Float32Array(n);
      if (attr && attr.itemSize === 1 && attr.array.length === n) {
        for (let i = 0; i < n; i++) arr[i] = attr.array[i] > thr ? 1 : 0;
      } else {
        // Fallback: position.y > thr.
        for (let i = 0; i < n; i++) arr[i] = pos.getY(i) > thr ? 1 : 0;
      }
      g.setAttribute(out, new THREE.BufferAttribute(arr, 1));
      return g;
    },
  },

  // 30. Mask Extract — keep only triangles whose mask attribute average
  //                     > threshold; drop the rest. The mask attribute
  //                     defaults to 'mask' (set by GreaterThan above).
  //                     Falls back to position.y > threshold if absent.
  maskExtract: {
    title: 'Mask Extract',
    category: 'geomnodes',
    defaultParams: () => ({ attrName: 'mask', threshold: 0.5 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const pos = g.attributes.position;
      const triCount = pos.count / 3;
      const name = String(this.params.attrName || 'mask');
      // Use Number() then fallback so an explicit threshold:0 is honoured
      // (the `+x || dflt` idiom would force 0 → dflt).
      const thr = (typeof this.params.threshold === 'number') ? this.params.threshold : 0.5;
      const attr = g.attributes[name];
      const useAttr = !!(attr && attr.itemSize === 1 && attr.array.length === pos.count);
      // Decide per triangle.
      const keep = new Uint8Array(triCount);
      let kept = 0;
      for (let t = 0; t < triCount; t++) {
        const i0 = t * 3, i1 = t * 3 + 1, i2 = t * 3 + 2;
        let avg;
        if (useAttr) {
          avg = (attr.array[i0] + attr.array[i1] + attr.array[i2]) / 3;
        } else {
          avg = (pos.getY(i0) + pos.getY(i1) + pos.getY(i2)) / 3;
        }
        if (avg > thr) { keep[t] = 1; kept++; }
      }
      if (kept === 0) return emptyGeometry();
      const out = new Float32Array(kept * 9);
      let o = 0;
      const arr = pos.array;
      for (let t = 0; t < triCount; t++) {
        if (!keep[t]) continue;
        const s = t * 9;
        for (let k = 0; k < 9; k++) out[o++] = arr[s + k];
      }
      return geoFromTris(out);
    },
  },
};

// Public iteration list.
export function listTotalKinds() {
  return Object.keys(TOTAL_NODE_KINDS);
}

// Stand-alone applicator: given a kind name, a params object and an
// inputs Map (or plain object) of name → BufferGeometry, run the eval
// and return the resulting BufferGeometry. Used by __studioGeomTotalApply.
export function applyTotalKind(kind, params, inputs) {
  const def = TOTAL_NODE_KINDS[kind];
  if (!def) throw new Error(`unknown geom-total kind: ${kind}`);
  const ins = (inputs instanceof Map)
    ? inputs
    : new Map(Object.entries(inputs || {}));
  const node = {
    kind,
    params: { ...def.defaultParams(), ...(params || {}) },
  };
  const ctx = {
    now: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(),
  };
  return def.eval.call(node, ctx, ins);
}
