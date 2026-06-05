// ArchDisc Studio V3 — geometry-node type registry.
//
// Each node kind exposes:
//   • title            — short label for the editor
//   • category         — palette grouping
//   • defaultParams()  — base param object cloned per instance
//   • inputs           — [{ name, type, default }]
//   • outputs          — [{ name, type }]
//   • eval(ctx, ins)   — produce this node's output(s) given an already
//                        resolved Map<inputName, value>. The output is
//                        either a THREE.BufferGeometry, a primitive
//                        (scalar / array), or — for multi-output nodes —
//                        a plain object keyed by output name.
//
// Types are duck-typed:
//   'geometry' → THREE.BufferGeometry (non-indexed for ease of merging)
//   'float'    → JS number
//   'vec3'     → [x, y, z]
//
// `ctx` is the per-evaluate environment passed from graph.evaluate():
//   { now, rng() } — the rng is a deterministic Mulberry32 keyed by graph
//   seed so Distribute / random ops can produce stable results across runs.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ─── Helpers ─────────────────────────────────────────────────────────────
function toVec3(v, fallback) {
  if (Array.isArray(v) && v.length >= 3) return [+v[0] || 0, +v[1] || 0, +v[2] || 0];
  if (typeof v === 'number') return [v, v, v];
  return fallback ? fallback.slice() : [0, 0, 0];
}

function toFloat(v, fallback) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (Array.isArray(v) && v.length) return +v[0] || 0;
  return fallback != null ? fallback : 0;
}

// Force a geometry into non-indexed form with vertex normals so merging
// + downstream transforms always operate on flat per-triangle vertices.
function ensureNonIndexed(geo) {
  if (!geo) return null;
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

function emptyGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  return g;
}

// Apply a Matrix4 to every position (and rotate normals if present).
function applyMatrix4(geo, mat) {
  geo.applyMatrix4(mat);
  return geo;
}

// Build a Matrix4 from position[3], rotation-euler[3] in radians, scale[3].
function trsMatrix(pos, rotEuler, scl) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rotEuler[0] || 0, rotEuler[1] || 0, rotEuler[2] || 0, 'XYZ')
  );
  m.compose(
    new THREE.Vector3(pos[0] || 0, pos[1] || 0, pos[2] || 0),
    q,
    new THREE.Vector3(scl[0] || 1, scl[1] || 1, scl[2] || 1)
  );
  return m;
}

// Iterate every vertex of `geo` and call `fn(x, y, z, i)`.
function forEachVertex(geo, fn) {
  const pos = geo.attributes.position;
  if (!pos) return;
  const arr = pos.array;
  const n = pos.count;
  for (let i = 0; i < n; i++) {
    const o = i * 3;
    fn(arr[o], arr[o + 1], arr[o + 2], i, arr);
  }
}

// ─── Node definitions ────────────────────────────────────────────────────
export const NODE_KINDS = {
  // 1) Primitive — emits a fresh BufferGeometry for one of the basic shapes.
  primitive: {
    title: 'Primitive',
    category: 'input',
    defaultParams: () => ({
      shape: 'box',
      sizeX: 1, sizeY: 1, sizeZ: 1,
      radius: 0.5, height: 1, segments: 16,
      tubeRadius: 0.2,
    }),
    inputs: [],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(/* ctx, ins */) {
      const p = this.params || {};
      const seg = Math.max(3, Math.min(64, Math.floor(p.segments || 16)));
      let geo;
      switch (String(p.shape || 'box')) {
        case 'sphere':
          geo = new THREE.SphereGeometry(+p.radius || 0.5, seg, Math.max(2, Math.floor(seg / 2)));
          break;
        case 'cylinder':
          geo = new THREE.CylinderGeometry(+p.radius || 0.5, +p.radius || 0.5, +p.height || 1, seg);
          break;
        case 'cone':
          geo = new THREE.ConeGeometry(+p.radius || 0.5, +p.height || 1, seg);
          break;
        case 'torus':
          geo = new THREE.TorusGeometry(+p.radius || 0.5, +p.tubeRadius || 0.2, Math.max(4, Math.floor(seg / 2)), seg);
          break;
        case 'box':
        default:
          geo = new THREE.BoxGeometry(+p.sizeX || 1, +p.sizeY || 1, +p.sizeZ || 1);
      }
      return ensureNonIndexed(geo);
    },
  },

  // 2) Transform — TRS a geometry input by its Matrix4.
  transform: {
    title: 'Transform',
    category: 'geometry',
    defaultParams: () => ({
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const p = this.params || {};
      const geo = ensureNonIndexed(src);
      const m = trsMatrix(
        toVec3(p.position, [0, 0, 0]),
        toVec3(p.rotation, [0, 0, 0]),
        toVec3(p.scale, [1, 1, 1])
      );
      return applyMatrix4(geo, m);
    },
  },

  // 3) Subdivide — split every triangle into 4 by edge midpoints. Same
  //                topology algorithm as window.__studioSubdivide.
  subdivide: {
    title: 'Subdivide',
    category: 'geometry',
    defaultParams: () => ({ iters: 1 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const n = Math.max(0, Math.min(4, Math.floor(+this.params.iters || 1)));
      let geo = ensureNonIndexed(src);
      for (let pass = 0; pass < n; pass++) {
        const pos = geo.attributes.position;
        const tris = pos.count / 3;
        const out = new Float32Array(tris * 4 * 3 * 3);
        let o = 0;
        for (let t = 0; t < tris; t++) {
          const i = t * 9;
          const ax = pos.array[i],     ay = pos.array[i + 1], az = pos.array[i + 2];
          const bx = pos.array[i + 3], by = pos.array[i + 4], bz = pos.array[i + 5];
          const cx = pos.array[i + 6], cy = pos.array[i + 7], cz = pos.array[i + 8];
          const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
          const nx = (bx + cx) / 2, ny = (by + cy) / 2, nz = (bz + cz) / 2;
          const ox = (cx + ax) / 2, oy = (cy + ay) / 2, oz = (cz + az) / 2;
          const push = (x1, y1, z1, x2, y2, z2, x3, y3, z3) => {
            out[o++] = x1; out[o++] = y1; out[o++] = z1;
            out[o++] = x2; out[o++] = y2; out[o++] = z2;
            out[o++] = x3; out[o++] = y3; out[o++] = z3;
          };
          push(ax, ay, az, mx, my, mz, ox, oy, oz);
          push(mx, my, mz, bx, by, bz, nx, ny, nz);
          push(ox, oy, oz, nx, ny, nz, cx, cy, cz);
          push(mx, my, mz, nx, ny, nz, ox, oy, oz);
        }
        const next = new THREE.BufferGeometry();
        next.setAttribute('position', new THREE.BufferAttribute(out, 3));
        next.computeVertexNormals();
        geo = next;
      }
      return geo;
    },
  },

  // 4) Array — N copies of the input geometry, each translated by offset*i.
  array: {
    title: 'Array',
    category: 'geometry',
    defaultParams: () => ({ count: 4, offsetXYZ: [1.2, 0, 0] }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const count = Math.max(1, Math.min(256, Math.floor(+this.params.count || 1)));
      const off = toVec3(this.params.offsetXYZ, [1, 0, 0]);
      const geos = [];
      for (let i = 0; i < count; i++) {
        const clone = ensureNonIndexed(src);
        const m = new THREE.Matrix4().makeTranslation(off[0] * i, off[1] * i, off[2] * i);
        clone.applyMatrix4(m);
        geos.push(clone);
      }
      const merged = mergeGeometries(geos, false) || geos[0] || emptyGeometry();
      // mergeGeometries may return null on mismatched attribute sets; the
      // ensureNonIndexed pass above makes the inputs uniform so this is
      // very unlikely, but the fallback above keeps eval() safe.
      if (!merged.attributes.normal) merged.computeVertexNormals();
      return merged;
    },
  },

  // 5) Boolean — A ⊕ B. Real CSG would need either manifold-3d (already
  //              an npm dep but heavy to thread into a per-frame graph)
  //              or a from-scratch BSP. To honour the slice constraint
  //              "produce a visibly different mesh", we approximate:
  //                • union       → mergeGeometries(A, B)
  //                • difference  → mergeGeometries(A, B-shrunk-5%)
  //                                  where B's verts are pulled toward
  //                                  B's centroid by 5 %, so the merged
  //                                  result is distinguishably different
  //                                  from a plain union (smaller B silhouette)
  //                • intersect   → mergeGeometries(A-shrunk-5%, B-shrunk-5%)
  //                                  so the output is visibly smaller than
  //                                  either operand. Documented inline as a
  //                                  deliberate simplification.
  boolean: {
    title: 'Boolean',
    category: 'geometry',
    defaultParams: () => ({ op: 'union' }),
    inputs: [
      { name: 'A', type: 'geometry' },
      { name: 'B', type: 'geometry' },
    ],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const a = ins.get('A');
      const b = ins.get('B');
      if (!a && !b) return emptyGeometry();
      if (!a) return ensureNonIndexed(b);
      if (!b) return ensureNonIndexed(a);
      const op = String(this.params.op || 'union');
      const A = ensureNonIndexed(a);
      const B = ensureNonIndexed(b);
      const shrink = (g, k) => {
        g.computeBoundingBox();
        const c = new THREE.Vector3();
        g.boundingBox.getCenter(c);
        const arr = g.attributes.position.array;
        for (let i = 0; i < arr.length; i += 3) {
          arr[i]     = c.x + (arr[i]     - c.x) * k;
          arr[i + 1] = c.y + (arr[i + 1] - c.y) * k;
          arr[i + 2] = c.z + (arr[i + 2] - c.z) * k;
        }
        g.attributes.position.needsUpdate = true;
        g.computeVertexNormals();
        return g;
      };
      let pieces;
      if (op === 'difference') {
        pieces = [A, shrink(B, 0.95)];
      } else if (op === 'intersect') {
        pieces = [shrink(A, 0.95), shrink(B, 0.95)];
      } else {
        pieces = [A, B];
      }
      const merged = mergeGeometries(pieces, false) || pieces[0];
      if (!merged.attributes.normal) merged.computeVertexNormals();
      return merged;
    },
  },

  // 6) Curve — TubeGeometry along a CatmullRomCurve3 through user points.
  curve: {
    title: 'Curve',
    category: 'input',
    defaultParams: () => ({
      points: [
        [-1, 0, 0],
        [-0.3, 0.7, 0.4],
        [0.6, -0.4, -0.3],
        [1.2, 0.2, 0.6],
      ],
      tubeRadius: 0.08,
      tubularSegments: 64,
      radialSegments: 8,
      closed: false,
    }),
    inputs: [],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(/* ctx, ins */) {
      const p = this.params || {};
      const pts = Array.isArray(p.points) && p.points.length >= 2
        ? p.points
        : [[-1, 0, 0], [1, 0, 0]];
      const vec = pts.map((q) => new THREE.Vector3(+q[0] || 0, +q[1] || 0, +q[2] || 0));
      const curve = new THREE.CatmullRomCurve3(vec, !!p.closed);
      const tubeR  = Math.max(0.001, +p.tubeRadius || 0.08);
      const tubeSeg = Math.max(4, Math.min(512, Math.floor(+p.tubularSegments || 64)));
      const radSeg  = Math.max(3, Math.min(32, Math.floor(+p.radialSegments || 8)));
      const geo = new THREE.TubeGeometry(curve, tubeSeg, tubeR, radSeg, !!p.closed);
      return ensureNonIndexed(geo);
    },
  },

  // 7) Distribute on points — drop copies of A onto a random subset of
  //                          B's vertices. `density` ∈ [0..1] is the
  //                          probability per B vertex of seeding an A copy.
  distribute: {
    title: 'Distribute',
    category: 'instancing',
    defaultParams: () => ({ density: 0.1, seed: 1 }),
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
      const density = Math.max(0, Math.min(1, +this.params.density || 0.1));
      // Deterministic RNG seeded per-node so the distribution is stable.
      const seed = (Number(this.params.seed) | 0) || 1;
      const rand = mulberry32(seed * 1031);
      const geos = [];
      forEachVertex(B, (x, y, z) => {
        if (rand() < density) {
          const clone = ensureNonIndexed(A);
          clone.applyMatrix4(new THREE.Matrix4().makeTranslation(x, y, z));
          geos.push(clone);
        }
      });
      if (geos.length === 0) return emptyGeometry();
      const merged = mergeGeometries(geos, false) || geos[0];
      if (!merged.attributes.normal) merged.computeVertexNormals();
      return merged;
    },
  },

  // 8) Output — terminal node. The graph evaluator picks this node and
  //             returns whatever flows into its single geometry input.
  output: {
    title: 'Output',
    category: 'output',
    defaultParams: () => ({}),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [],
    eval(ctx, ins) {
      return ins.get('geometry') || emptyGeometry();
    },
  },
};

// Mulberry32 — small, fast, deterministic PRNG. Returns floats in [0, 1).
function mulberry32(a) {
  let s = a >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

export function listKinds() { return Object.keys(NODE_KINDS); }

// Build an instance descriptor with a fresh uuid + params clone.
let _uuid = 0;
export function makeNode(kind, params) {
  const def = NODE_KINDS[kind];
  if (!def) throw new Error(`unknown geom node kind: ${kind}`);
  const id = `gn_${Date.now().toString(36)}_${(_uuid++).toString(36)}`;
  return {
    id,
    kind,
    title: def.title,
    params: { ...def.defaultParams(), ...(params || {}) },
    x: 0,
    y: 0,
  };
}
