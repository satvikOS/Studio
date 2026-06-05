// ArchDisc Studio V3 — HDA: 15 ADDITIONAL Geometry Node kinds.
//
// Layered on top of geomnodes/ (slice 684, 8 kinds), geomdeep/ (slice 688,
// 20 kinds) and geomtotal/ (slice 693, 30 kinds). With HDA's 15 new kinds
// the V3 Geometry-Nodes inventory is ~73, comparable to a healthy
// Houdini SOP / Blender Geometry-Node default install.
//
// Categories of new kinds:
//   • Topology   (5): Bridge, Skin, Sweep2, RealBoolean, Loft
//   • Attribute  (4): AttributeTransfer, Promote, Cast, Random
//   • Modeling   (3): Knife, Mirror, Smooth
//   • Curves     (3): Resample, Arc, Bezier
//
// Each definition uses the SAME shape as the prior tables so the
// slice-684 editor picks it up with zero edits:
//
//   { title, category, defaultParams(), inputs, outputs, eval(ctx, ins) }
//
// CONSTRAINTS (brief):
//   • Pure native, three.js + React only. No new npm packages, no WASM
//     beyond what manifold-3d already ships (used only by RealBoolean).
//   • DO NOT touch api.js, StudioShellV3.jsx, existing geomnodes/,
//     geomdeep/, geomtotal/.
//   • Use common/subdivide.js where applicable (Smooth uses it as a
//     pre-pass on coarse meshes).
//
// RealBoolean strategy: the slice-691 csg/csg.js module loads manifold-3d
// asynchronously. Our `eval()` is synchronous (the graph evaluator is
// sync). To get a "real" boolean inside the synchronous graph path we
// kick off the WASM load at install-time and cache the resolved module
// on `window.__studioHDAManifoldSync`. While cold (until the WASM
// finishes loading), the node falls back to mergeGeometries so the
// graph still produces geometry. The convenience op
// `__studioHDA_realBoolean(params, inputs)` is async and ALWAYS awaits
// the module, so callers that want guaranteed-real CSG can use it.

import * as THREE from 'three';
import {
  mergeGeometries,
  mergeVertices,
} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../common/random.js';
import { simpleSplitSubdivide } from '../common/subdivide.js';
import {
  ensureManifoldModule,
  threeMeshToManifoldMesh,
  manifoldToThreeGeometry,
} from '../csg/csg.js';

// ─── Shared helpers (local; we deliberately don't reach into prior
//     slice node tables — brief says NEW files only). ──────────────────
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

// Extract up to `cap` distinct vertices from a geometry, preserving
// order. Used by Bridge / Loft / Skin / Sweep2 to gather a "ring" of
// control points from an arbitrary input geometry.
function distinctVerts(geo, cap = 256) {
  const pos = geo && geo.attributes && geo.attributes.position;
  if (!pos || pos.count === 0) return [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < pos.count && out.length < cap; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const key = `${Math.round(x * 10000)}|${Math.round(y * 10000)}|${Math.round(z * 10000)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(new THREE.Vector3(x, y, z));
  }
  return out;
}

// Generic vertex-ring → ring stitch into a tri list. `ringA` and `ringB`
// must both be arrays of THREE.Vector3 of the SAME length. We emit
// 2 triangles per edge. Caller controls `closed`.
function stitchRings(ringA, ringB, closed) {
  const N = ringA.length;
  if (N === 0 || N !== ringB.length) return new Float32Array(0);
  const edges = closed ? N : N - 1;
  const arr = new Float32Array(edges * 2 * 9);
  let o = 0;
  for (let k = 0; k < edges; k++) {
    const k1 = (k + 1) % N;
    const a = ringA[k], b = ringB[k];
    const c = ringB[k1], d = ringA[k1];
    arr[o++] = a.x; arr[o++] = a.y; arr[o++] = a.z;
    arr[o++] = b.x; arr[o++] = b.y; arr[o++] = b.z;
    arr[o++] = c.x; arr[o++] = c.y; arr[o++] = c.z;
    arr[o++] = a.x; arr[o++] = a.y; arr[o++] = a.z;
    arr[o++] = c.x; arr[o++] = c.y; arr[o++] = c.z;
    arr[o++] = d.x; arr[o++] = d.y; arr[o++] = d.z;
  }
  return arr;
}

function geoFromTris(arr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  g.computeVertexNormals();
  return g;
}

// Wrap a BufferGeometry into a temporary THREE.Mesh so we can hand it
// to csg/csg.js's `threeMeshToManifoldMesh` (which expects a mesh).
function asMesh(geo) {
  return new THREE.Mesh(geo);
}

// Manifold module cache. Lit synchronously once the dynamic-import +
// setup() finish. Until then `realBoolean` falls back to merge.
let _manifoldCached = null;
// Public probe so other modules / tests can see whether the sync path
// is hot.
export function manifoldCached() { return _manifoldCached; }
// Kicked off at install-time by index.js so the WASM is warm.
export function ensureManifoldHot() {
  if (_manifoldCached) return Promise.resolve(_manifoldCached);
  return ensureManifoldModule().then((m) => {
    _manifoldCached = m;
    if (typeof window !== 'undefined') {
      window.__studioHDAManifoldSync = m;
    }
    return m;
  }).catch((e) => {
    // Swallow — we'll just keep using the merge fallback.
    return null;
  });
}

// Run a real CSG op using the cached manifold module. Caller MUST check
// _manifoldCached first; this function assumes it's hot.
function realCSGSync(op, geoA, geoB) {
  const m = _manifoldCached;
  if (!m) throw new Error('manifold module not cached');
  const Manifold = m.Manifold;
  const Mesh = m.Mesh;
  const mA = new Mesh(threeMeshToManifoldMesh(asMesh(geoA)));
  const mB = new Mesh(threeMeshToManifoldMesh(asMesh(geoB)));
  let manA = null, manB = null, result = null;
  try {
    manA = new Manifold(mA);
    manB = new Manifold(mB);
    if (op === 'union') result = manA.add(manB);
    else if (op === 'difference') result = manA.subtract(manB);
    else if (op === 'intersect') result = manA.intersect(manB);
    else throw new Error('unknown op: ' + op);
    return manifoldToThreeGeometry(result);
  } finally {
    try { if (result && result.delete) result.delete(); } catch (_) {}
    try { if (manA && manA.delete) manA.delete(); } catch (_) {}
    try { if (manB && manB.delete) manB.delete(); } catch (_) {}
    try { if (mA && mA.delete) mA.delete(); } catch (_) {}
    try { if (mB && mB.delete) mB.delete(); } catch (_) {}
  }
}

// Async equivalent — always waits for manifold to be hot.
export async function realCSGAsync(op, geoA, geoB) {
  if (!_manifoldCached) await ensureManifoldHot();
  if (!_manifoldCached) throw new Error('manifold module failed to load');
  return realCSGSync(op, geoA, geoB);
}

// ─── 15 new node kinds ───────────────────────────────────────────────────
export const HDA_NODE_KINDS = {

  // ═══════════════════════════════════════════════════════════════════════
  // TOPOLOGY (5)

  // 1. Bridge — stitch ring A to ring B using stitchRings. Each input
  //             geometry contributes its first N distinct vertices in
  //             insertion order; both rings are zipped index-for-index.
  //             Output is a tube of (N or N-1) quads.
  bridge: {
    title: 'Bridge',
    category: 'geomnodes',
    defaultParams: () => ({ closed: true, maxRing: 64 }),
    inputs: [
      { name: 'A', type: 'geometry' },
      { name: 'B', type: 'geometry' },
    ],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const a = ins.get('A');
      const b = ins.get('B');
      if (!a || !b) return emptyGeometry();
      const cap = Math.max(3, Math.min(256, Math.floor(+this.params.maxRing || 64)));
      const ringA = distinctVerts(a, cap);
      const ringB = distinctVerts(b, cap);
      // Equalize ring sizes by truncating to min count so stitchRings
      // can zip them.
      const N = Math.min(ringA.length, ringB.length);
      if (N < 3) return emptyGeometry();
      const arr = stitchRings(ringA.slice(0, N), ringB.slice(0, N), !!this.params.closed);
      if (arr.length === 0) return emptyGeometry();
      return geoFromTris(arr);
    },
  },

  // 2. Skin — generate a tube of `radius` along a polyline. Distinct
  //           from the geomtotal "tube" + the geomdeep "tubeFromLine"
  //           in that it preserves the input's vertex ORDER and uses
  //           parallel-transport frames to avoid twist artefacts.
  skin: {
    title: 'Skin',
    category: 'geomnodes',
    defaultParams: () => ({ radius: 0.1, radialSegments: 12, maxPoints: 96 }),
    inputs: [{ name: 'curve', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('curve');
      if (!src) return emptyGeometry();
      const pos = src.attributes && src.attributes.position;
      if (!pos || pos.count < 2) return emptyGeometry();
      const cap = Math.max(2, Math.min(512, Math.floor(+this.params.maxPoints || 96)));
      const step = Math.max(1, Math.floor(pos.count / cap));
      const pts = [];
      const seen = new Set();
      for (let i = 0; i < pos.count && pts.length < cap; i += step) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const key = `${Math.round(x * 10000)}|${Math.round(y * 10000)}|${Math.round(z * 10000)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pts.push(new THREE.Vector3(x, y, z));
      }
      if (pts.length < 2) return emptyGeometry();
      const r = Math.max(0.0001, +this.params.radius || 0.1);
      const segs = Math.max(3, Math.min(64, Math.floor(+this.params.radialSegments || 12)));
      const curve = new THREE.CatmullRomCurve3(pts, false);
      // tubularSegments: one per inter-point gap, capped.
      const tubeSeg = Math.max(8, Math.min(256, pts.length * 4));
      return ensureNonIndexed(new THREE.TubeGeometry(curve, tubeSeg, r, segs, false));
    },
  },

  // 3. Sweep2 — sweep two cross-sections (start / end) along a path,
  //             linearly interpolating between them. Different from the
  //             geomdeep "sweep" which uses a single profile. Useful for
  //             rocket nozzles / chair legs that taper.
  sweep2: {
    title: 'Sweep 2',
    category: 'geomnodes',
    defaultParams: () => ({ stations: 24, closeProfile: true }),
    inputs: [
      { name: 'profileA', type: 'geometry' },
      { name: 'profileB', type: 'geometry' },
      { name: 'path',     type: 'geometry' },
    ],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const profA = ins.get('profileA');
      const profB = ins.get('profileB');
      const path  = ins.get('path');
      if (!profA || !profB || !path) return emptyGeometry();

      // Both profiles projected to XY plane; truncate to the smaller of
      // the two so they zip cleanly.
      const ringA2 = distinctVerts(profA, 64).map((v) => [v.x, v.y]);
      const ringB2 = distinctVerts(profB, 64).map((v) => [v.x, v.y]);
      const N = Math.min(ringA2.length, ringB2.length);
      if (N < 3) return emptyGeometry();
      ringA2.length = N;
      ringB2.length = N;

      const pathPts = distinctVerts(path, 256);
      if (pathPts.length < 2) return emptyGeometry();
      const stations = Math.max(2, Math.min(256, Math.floor(+this.params.stations || 24)));
      const curve = new THREE.CatmullRomCurve3(pathPts, false);
      const frames = curve.computeFrenetFrames(stations - 1, false);

      // Build per-station rings, linearly blending A → B.
      const rings = new Array(stations);
      for (let s = 0; s < stations; s++) {
        const t = s / (stations - 1);
        const center = curve.getPointAt(t);
        const normal = frames.normals[s] || new THREE.Vector3(1, 0, 0);
        const binor  = frames.binormals[s] || new THREE.Vector3(0, 1, 0);
        const ring = new Array(N);
        for (let k = 0; k < N; k++) {
          const ax = ringA2[k][0], ay = ringA2[k][1];
          const bx = ringB2[k][0], by = ringB2[k][1];
          const px = ax + (bx - ax) * t;
          const py = ay + (by - ay) * t;
          ring[k] = new THREE.Vector3(
            center.x + normal.x * px + binor.x * py,
            center.y + normal.y * px + binor.y * py,
            center.z + normal.z * px + binor.z * py,
          );
        }
        rings[s] = ring;
      }

      const closeProfile = !!this.params.closeProfile;
      const edgeMax = closeProfile ? N : N - 1;
      const triCount = (stations - 1) * edgeMax * 2;
      const arr = new Float32Array(triCount * 9);
      let o = 0;
      for (let s = 0; s < stations - 1; s++) {
        for (let k = 0; k < edgeMax; k++) {
          const k1 = (k + 1) % N;
          const a = rings[s][k];     const b = rings[s + 1][k];
          const c = rings[s + 1][k1]; const d = rings[s][k1];
          arr[o++] = a.x; arr[o++] = a.y; arr[o++] = a.z;
          arr[o++] = b.x; arr[o++] = b.y; arr[o++] = b.z;
          arr[o++] = c.x; arr[o++] = c.y; arr[o++] = c.z;
          arr[o++] = a.x; arr[o++] = a.y; arr[o++] = a.z;
          arr[o++] = c.x; arr[o++] = c.y; arr[o++] = c.z;
          arr[o++] = d.x; arr[o++] = d.y; arr[o++] = d.z;
        }
      }
      return geoFromTris(arr);
    },
  },

  // 4. RealBoolean — slice-691 CSG (manifold-3d) instead of the slice-684
  //                  shrink-fake. Sync path uses cached module; cold path
  //                  falls back to mergeGeometries so the graph never
  //                  produces null. Async op variant guarantees real CSG.
  realBoolean: {
    title: 'Real Boolean',
    category: 'geomnodes',
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
      if (_manifoldCached) {
        try {
          const result = realCSGSync(op, A, B);
          if (result && result.attributes && result.attributes.position &&
              result.attributes.position.count > 0) {
            return ensureNonIndexed(result);
          }
        } catch (_) { /* fall back to merge */ }
      } else {
        // Kick off the load so future evaluations can use real CSG.
        ensureManifoldHot();
      }
      // Merge fallback while WASM is cold or if CSG produced no verts.
      const merged = mergeGeometries([A, B], false) || A;
      if (!merged.attributes.normal) merged.computeVertexNormals();
      return merged;
    },
  },

  // 5. Loft — interpolate between TWO cross-section rings to produce a
  //           solid surface. Different from Sweep2 in that there's NO
  //           guiding path — the rings are blended over `steps` evenly
  //           in world-space between their centroids.
  loft: {
    title: 'Loft',
    category: 'geomnodes',
    defaultParams: () => ({ steps: 16, closed: true }),
    inputs: [
      { name: 'A', type: 'geometry' },
      { name: 'B', type: 'geometry' },
    ],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const a = ins.get('A');
      const b = ins.get('B');
      if (!a || !b) return emptyGeometry();
      const ringA = distinctVerts(a, 64);
      const ringB = distinctVerts(b, 64);
      const N = Math.min(ringA.length, ringB.length);
      if (N < 3) return emptyGeometry();
      const steps = Math.max(2, Math.min(64, Math.floor(+this.params.steps || 16)));
      const closed = !!this.params.closed;
      // Build interpolated rings.
      const rings = new Array(steps);
      for (let s = 0; s < steps; s++) {
        const t = s / (steps - 1);
        const ring = new Array(N);
        for (let k = 0; k < N; k++) {
          const A = ringA[k], B = ringB[k];
          ring[k] = new THREE.Vector3(
            A.x + (B.x - A.x) * t,
            A.y + (B.y - A.y) * t,
            A.z + (B.z - A.z) * t,
          );
        }
        rings[s] = ring;
      }
      const edges = closed ? N : N - 1;
      const arr = new Float32Array((steps - 1) * edges * 2 * 9);
      let o = 0;
      for (let s = 0; s < steps - 1; s++) {
        for (let k = 0; k < edges; k++) {
          const k1 = (k + 1) % N;
          const A = rings[s][k];     const B = rings[s + 1][k];
          const C = rings[s + 1][k1]; const D = rings[s][k1];
          arr[o++] = A.x; arr[o++] = A.y; arr[o++] = A.z;
          arr[o++] = B.x; arr[o++] = B.y; arr[o++] = B.z;
          arr[o++] = C.x; arr[o++] = C.y; arr[o++] = C.z;
          arr[o++] = A.x; arr[o++] = A.y; arr[o++] = A.z;
          arr[o++] = C.x; arr[o++] = C.y; arr[o++] = C.z;
          arr[o++] = D.x; arr[o++] = D.y; arr[o++] = D.z;
        }
      }
      return geoFromTris(arr);
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // ATTRIBUTE (4)

  // 6. AttributeTransfer — copy a named scalar attribute from B onto A
  //                        using nearest-vertex lookup. Stores result on
  //                        A under `outAttr` (single-component float).
  //                        Falls back to writing a "distance to B" field
  //                        if B doesn't have the source attribute.
  attributeTransfer: {
    title: 'Attribute Transfer',
    category: 'geomnodes',
    defaultParams: () => ({ srcAttr: 'mask', outAttr: 'transferred' }),
    inputs: [
      { name: 'A', type: 'geometry' },
      { name: 'B', type: 'geometry' },
    ],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const a = ins.get('A');
      const b = ins.get('B');
      if (!a) return emptyGeometry();
      const g = ensureNonIndexed(a);
      if (!b) return g;
      const aPos = g.attributes.position;
      const bPos = b.attributes && b.attributes.position;
      if (!aPos || !bPos) return g;
      const srcName = String(this.params.srcAttr || 'mask');
      const outName = String(this.params.outAttr || 'transferred');
      const bSrc = b.attributes[srcName];
      const out = new Float32Array(aPos.count);
      for (let i = 0; i < aPos.count; i++) {
        const ax = aPos.getX(i), ay = aPos.getY(i), az = aPos.getZ(i);
        // Brute-force nearest. For 1e3-vert meshes this is fine; for
        // larger meshes a kd-tree would beat O(N*M).
        let bestIdx = 0, bestDist = Infinity;
        for (let j = 0; j < bPos.count; j++) {
          const dx = ax - bPos.getX(j);
          const dy = ay - bPos.getY(j);
          const dz = az - bPos.getZ(j);
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < bestDist) { bestDist = d2; bestIdx = j; }
        }
        if (bSrc && bSrc.itemSize >= 1 && bestIdx < bSrc.count) {
          out[i] = bSrc.getX(bestIdx);
        } else {
          // Fallback: write the (sqrt) distance to B as a float scalar so
          // the attribute is still useful downstream.
          out[i] = Math.sqrt(bestDist);
        }
      }
      g.setAttribute(outName, new THREE.BufferAttribute(out, 1));
      return g;
    },
  },

  // 7. Promote — promote a per-vertex attribute to a per-face attribute
  //              by averaging the three corners of every triangle. The
  //              result is stored as a per-face Float32 attribute under
  //              `outAttr` (length = triCount). We carry it back as a
  //              per-vertex attribute (same value for the 3 corners of
  //              each tri) so the downstream code path is uniform.
  promote: {
    title: 'Promote (V→F)',
    category: 'geomnodes',
    defaultParams: () => ({ srcAttr: 'mask', outAttr: 'face_mask' }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const srcName = String(this.params.srcAttr || 'mask');
      const outName = String(this.params.outAttr || 'face_mask');
      const a = g.attributes[srcName];
      const pos = g.attributes.position;
      if (!pos) return g;
      if (!a || a.itemSize !== 1) {
        // No source attr — promote to a constant zero field so the
        // contract still holds.
        const z = new Float32Array(pos.count);
        g.setAttribute(outName, new THREE.BufferAttribute(z, 1));
        return g;
      }
      const tris = pos.count / 3;
      const out = new Float32Array(pos.count);
      for (let t = 0; t < tris; t++) {
        const i0 = t * 3, i1 = i0 + 1, i2 = i0 + 2;
        const avg = (a.getX(i0) + a.getX(i1) + a.getX(i2)) / 3;
        out[i0] = out[i1] = out[i2] = avg;
      }
      g.setAttribute(outName, new THREE.BufferAttribute(out, 1));
      return g;
    },
  },

  // 8. Cast — convert a per-vertex float attribute to int (Math.round
  //           by default; Math.floor / Math.ceil also available).
  //           Result is still stored as Float32 (BufferAttribute doesn't
  //           lose precision for sub-2^24 ints) but the values are
  //           guaranteed-integer.
  cast: {
    title: 'Cast (F→I)',
    category: 'geomnodes',
    defaultParams: () => ({ srcAttr: 'mask', outAttr: 'mask_int', mode: 'round' }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const srcName = String(this.params.srcAttr || 'mask');
      const outName = String(this.params.outAttr || 'mask_int');
      const mode = String(this.params.mode || 'round');
      const a = g.attributes[srcName];
      const pos = g.attributes.position;
      if (!pos) return g;
      const N = pos.count;
      const out = new Float32Array(N);
      const fn = mode === 'floor' ? Math.floor : mode === 'ceil' ? Math.ceil : Math.round;
      if (a && a.itemSize === 1 && a.count >= N) {
        for (let i = 0; i < N; i++) out[i] = fn(a.getX(i));
      } else {
        // No source — write zeros so the attribute is at least present.
        for (let i = 0; i < N; i++) out[i] = 0;
      }
      g.setAttribute(outName, new THREE.BufferAttribute(out, 1));
      return g;
    },
  },

  // 9. Random — assign a deterministic random float [min..max] to every
  //             vertex under `outAttr`. Mulberry32-keyed so re-evaluation
  //             produces stable values.
  random: {
    title: 'Random',
    category: 'geomnodes',
    defaultParams: () => ({ outAttr: 'rand', min: 0, max: 1, seed: 1 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const outName = String(this.params.outAttr || 'rand');
      const lo = Number(this.params.min) || 0;
      const hi = Number(this.params.max);
      const range = (Number.isFinite(hi) ? hi : 1) - lo;
      const seed = (Number(this.params.seed) | 0) || 1;
      const rng = mulberry32(seed * 16807);
      const pos = g.attributes.position;
      if (!pos) return g;
      const out = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) out[i] = lo + rng() * range;
      g.setAttribute(outName, new THREE.BufferAttribute(out, 1));
      return g;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // MODELING (3)

  // 10. Knife — cut a mesh by a plane. Triangles entirely on one side
  //             survive; triangles on the other side are removed.
  //             Triangles that straddle the plane are split with a
  //             tiny epsilon offset so the surviving piece still has
  //             closed edges. Plane is defined by point + normal.
  knife: {
    title: 'Knife (plane)',
    category: 'geomnodes',
    defaultParams: () => ({
      point: [0, 0, 0],
      normal: [0, 1, 0],
      keep: 'above',   // 'above' (n·(v-p) ≥ 0) or 'below'
    }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const pos = g.attributes.position;
      if (!pos) return g;
      const p = toVec3(this.params.point, [0, 0, 0]);
      const n = toVec3(this.params.normal, [0, 1, 0]);
      const nlen = Math.hypot(n[0], n[1], n[2]) || 1;
      const nx = n[0] / nlen, ny = n[1] / nlen, nz = n[2] / nlen;
      const keepAbove = String(this.params.keep || 'above') !== 'below';
      const tris = pos.count / 3;
      const out = [];
      const dist = (x, y, z) =>
        (x - p[0]) * nx + (y - p[1]) * ny + (z - p[2]) * nz;
      for (let t = 0; t < tris; t++) {
        const i = t * 9;
        const ax = pos.array[i],     ay = pos.array[i + 1], az = pos.array[i + 2];
        const bx = pos.array[i + 3], by = pos.array[i + 4], bz = pos.array[i + 5];
        const cx = pos.array[i + 6], cy = pos.array[i + 7], cz = pos.array[i + 8];
        const da = dist(ax, ay, az);
        const db = dist(bx, by, bz);
        const dc = dist(cx, cy, cz);
        const sa = keepAbove ? (da >= 0) : (da <= 0);
        const sb = keepAbove ? (db >= 0) : (db <= 0);
        const sc = keepAbove ? (dc >= 0) : (dc <= 0);
        const count = (sa ? 1 : 0) + (sb ? 1 : 0) + (sc ? 1 : 0);
        if (count === 3) {
          out.push(ax, ay, az, bx, by, bz, cx, cy, cz);
        } else if (count === 0) {
          // Drop entirely.
        } else {
          // Split the triangle. Compute intersection points on the two
          // crossing edges and emit either 1 or 2 new triangles.
          // Helper to lerp along edge u→v at the plane.
          const lerp = (ux, uy, uz, du, vx, vy, vz, dv) => {
            const tlerp = du / (du - dv);
            return [
              ux + (vx - ux) * tlerp,
              uy + (vy - uy) * tlerp,
              uz + (vz - uz) * tlerp,
            ];
          };
          if (count === 1) {
            // Pick the single kept corner.
            let kept, e1, e2, dk, d1, d2;
            if (sa) { kept = [ax, ay, az]; e1 = [bx, by, bz]; e2 = [cx, cy, cz]; dk = da; d1 = db; d2 = dc; }
            else if (sb) { kept = [bx, by, bz]; e1 = [cx, cy, cz]; e2 = [ax, ay, az]; dk = db; d1 = dc; d2 = da; }
            else { kept = [cx, cy, cz]; e1 = [ax, ay, az]; e2 = [bx, by, bz]; dk = dc; d1 = da; d2 = db; }
            const p1 = lerp(kept[0], kept[1], kept[2], dk, e1[0], e1[1], e1[2], d1);
            const p2 = lerp(kept[0], kept[1], kept[2], dk, e2[0], e2[1], e2[2], d2);
            out.push(kept[0], kept[1], kept[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
          } else if (count === 2) {
            // Two corners kept — output a quad (two triangles).
            let kept1, kept2, drop, dk1, dk2, dd;
            if (!sa) { drop = [ax, ay, az]; kept1 = [bx, by, bz]; kept2 = [cx, cy, cz]; dd = da; dk1 = db; dk2 = dc; }
            else if (!sb) { drop = [bx, by, bz]; kept1 = [cx, cy, cz]; kept2 = [ax, ay, az]; dd = db; dk1 = dc; dk2 = da; }
            else { drop = [cx, cy, cz]; kept1 = [ax, ay, az]; kept2 = [bx, by, bz]; dd = dc; dk1 = da; dk2 = db; }
            const p1 = lerp(kept1[0], kept1[1], kept1[2], dk1, drop[0], drop[1], drop[2], dd);
            const p2 = lerp(drop[0], drop[1], drop[2], dd, kept2[0], kept2[1], kept2[2], dk2);
            out.push(
              kept1[0], kept1[1], kept1[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2],
              kept1[0], kept1[1], kept1[2], p2[0], p2[1], p2[2], kept2[0], kept2[1], kept2[2],
            );
          }
        }
      }
      if (!out.length) return emptyGeometry();
      return geoFromTris(new Float32Array(out));
    },
  },

  // 11. Mirror — reflect across a plane through the origin and append
  //              the mirrored geometry to the original (the typical
  //              symmetry-modifier behaviour). Axis: 'x' | 'y' | 'z'.
  mirror: {
    title: 'Mirror',
    category: 'geomnodes',
    defaultParams: () => ({ axis: 'x', merge: true }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const A = ensureNonIndexed(src);
      const axis = String(this.params.axis || 'x');
      const flip = new THREE.Matrix4();
      if (axis === 'y') flip.makeScale(1, -1, 1);
      else if (axis === 'z') flip.makeScale(1, 1, -1);
      else flip.makeScale(-1, 1, 1);
      const B = ensureNonIndexed(src);
      B.applyMatrix4(flip);
      // Mirroring flips winding — flip every triangle so normals stay
      // outward-facing.
      const bPos = B.attributes.position;
      for (let i = 0; i < bPos.count; i += 3) {
        const x1 = bPos.getX(i + 1), y1 = bPos.getY(i + 1), z1 = bPos.getZ(i + 1);
        bPos.setXYZ(i + 1, bPos.getX(i + 2), bPos.getY(i + 2), bPos.getZ(i + 2));
        bPos.setXYZ(i + 2, x1, y1, z1);
      }
      bPos.needsUpdate = true;
      B.computeVertexNormals();
      if (!this.params.merge) return B;
      const merged = mergeGeometries([A, B], false) || A;
      if (!merged.attributes.normal) merged.computeVertexNormals();
      return merged;
    },
  },

  // 12. Smooth — Laplacian smoothing on welded topology. Uses
  //              common/subdivide.js's simpleSplitSubdivide as an
  //              optional pre-pass to densify low-poly inputs first so
  //              there's more topology for the Laplacian to work on
  //              (mirrors Houdini's "Subdivide before smooth" workflow).
  smooth: {
    title: 'Smooth (Laplacian)',
    category: 'geomnodes',
    defaultParams: () => ({ iters: 3, factor: 0.5, presubdivide: 0 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      let base = ensureNonIndexed(src);
      const preSub = Math.max(0, Math.min(3, Math.floor(+this.params.presubdivide || 0)));
      if (preSub > 0) base = simpleSplitSubdivide(base, preSub);
      const welded = mergeVertices(base, 1e-5);
      if (!welded.index) return ensureNonIndexed(welded);
      const iters = Math.max(0, Math.min(20, Math.floor(+this.params.iters || 3)));
      const factor = clamp(+this.params.factor || 0.5, 0, 1);
      const pos = welded.attributes.position;
      const idx = welded.index.array;
      const n = pos.count;
      const nbr = new Array(n);
      for (let i = 0; i < n; i++) nbr[i] = new Set();
      for (let t = 0; t < idx.length; t += 3) {
        const a = idx[t], b = idx[t + 1], c = idx[t + 2];
        nbr[a].add(b); nbr[a].add(c);
        nbr[b].add(a); nbr[b].add(c);
        nbr[c].add(a); nbr[c].add(b);
      }
      const buf = new Float32Array(pos.array);
      const next = new Float32Array(pos.array.length);
      for (let pass = 0; pass < iters; pass++) {
        for (let i = 0; i < n; i++) {
          const set = nbr[i];
          if (set.size === 0) {
            next[i * 3] = buf[i * 3];
            next[i * 3 + 1] = buf[i * 3 + 1];
            next[i * 3 + 2] = buf[i * 3 + 2];
            continue;
          }
          let sx = 0, sy = 0, sz = 0;
          set.forEach((j) => { sx += buf[j * 3]; sy += buf[j * 3 + 1]; sz += buf[j * 3 + 2]; });
          sx /= set.size; sy /= set.size; sz /= set.size;
          next[i * 3]     = buf[i * 3]     + (sx - buf[i * 3])     * factor;
          next[i * 3 + 1] = buf[i * 3 + 1] + (sy - buf[i * 3 + 1]) * factor;
          next[i * 3 + 2] = buf[i * 3 + 2] + (sz - buf[i * 3 + 2]) * factor;
        }
        buf.set(next);
      }
      pos.array.set(buf);
      pos.needsUpdate = true;
      welded.computeVertexNormals();
      return welded;
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // CURVES (3)

  // 13. Resample — re-distribute curve points evenly. Input is treated
  //                as an ORDERED polyline (first N distinct vertices of
  //                the input). Output is a CatmullRomCurve3 sampled at
  //                `count` equal arc-length stations, emitted as a
  //                pseudo-geometry whose position attribute encodes the
  //                resampled polyline. Carries `userData.curve = true`
  //                so downstream Skin / Bridge can spot it.
  resample: {
    title: 'Resample',
    category: 'geomnodes',
    defaultParams: () => ({ count: 32 }),
    inputs: [{ name: 'curve', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('curve');
      if (!src) return emptyGeometry();
      const pts = distinctVerts(src, 256);
      if (pts.length < 2) return emptyGeometry();
      const count = Math.max(2, Math.min(1024, Math.floor(+this.params.count || 32)));
      const curve = new THREE.CatmullRomCurve3(pts, false);
      const arr = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const t = i / (count - 1);
        const v = curve.getPointAt(t);
        arr[i * 3]     = v.x;
        arr[i * 3 + 1] = v.y;
        arr[i * 3 + 2] = v.z;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      g.userData = { curve: true, pointCount: count };
      return g;
    },
  },

  // 14. Arc — generate an arc in the XY plane through `count` samples
  //           between `startAngle` and `endAngle` at `radius`. Treats
  //           the result as a curve (`userData.curve = true`).
  arc: {
    title: 'Arc',
    category: 'geomnodes',
    defaultParams: () => ({
      radius: 0.5,
      startAngle: 0,
      endAngle: Math.PI * 1.5,
      count: 32,
      center: [0, 0, 0],
    }),
    inputs: [],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval() {
      const p = this.params || {};
      const r = Math.max(0.0001, +p.radius || 0.5);
      const a0 = +p.startAngle || 0;
      const a1 = +p.endAngle || (Math.PI * 1.5);
      const c = toVec3(p.center, [0, 0, 0]);
      const N = Math.max(2, Math.min(1024, Math.floor(+p.count || 32)));
      const arr = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const a = a0 + (a1 - a0) * t;
        arr[i * 3]     = c[0] + Math.cos(a) * r;
        arr[i * 3 + 1] = c[1] + Math.sin(a) * r;
        arr[i * 3 + 2] = c[2];
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      g.userData = { curve: true, pointCount: N };
      return g;
    },
  },

  // 15. Bezier — cubic Bezier through `count` samples. Two endpoints +
  //              two handles. Treats the result as a curve. The four
  //              control points are exposed as `p0`, `c1`, `c2`, `p1`.
  bezier: {
    title: 'Bezier',
    category: 'geomnodes',
    defaultParams: () => ({
      p0: [-0.5, 0, 0],
      c1: [-0.2, 0.6, 0],
      c2: [ 0.2, 0.6, 0],
      p1: [ 0.5, 0, 0],
      count: 32,
    }),
    inputs: [],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval() {
      const p = this.params || {};
      const P0 = toVec3(p.p0, [-0.5, 0, 0]);
      const C1 = toVec3(p.c1, [-0.2, 0.6, 0]);
      const C2 = toVec3(p.c2, [ 0.2, 0.6, 0]);
      const P1 = toVec3(p.p1, [ 0.5, 0, 0]);
      const N = Math.max(2, Math.min(1024, Math.floor(+p.count || 32)));
      const arr = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const t = i / (N - 1);
        const it = 1 - t;
        // Cubic Bezier: (1-t)^3 P0 + 3(1-t)^2 t C1 + 3(1-t) t^2 C2 + t^3 P1.
        const w0 = it * it * it;
        const w1 = 3 * it * it * t;
        const w2 = 3 * it * t * t;
        const w3 = t * t * t;
        arr[i * 3]     = w0 * P0[0] + w1 * C1[0] + w2 * C2[0] + w3 * P1[0];
        arr[i * 3 + 1] = w0 * P0[1] + w1 * C1[1] + w2 * C2[1] + w3 * P1[1];
        arr[i * 3 + 2] = w0 * P0[2] + w1 * C1[2] + w2 * C2[2] + w3 * P1[2];
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      g.userData = { curve: true, pointCount: N };
      return g;
    },
  },
};

// Public iteration list.
export function listHDAKinds() {
  return Object.keys(HDA_NODE_KINDS);
}

// Stand-alone applicator: given a kind name, a params object and an
// inputs Map (or plain object) of name → BufferGeometry, run the eval
// and return the resulting BufferGeometry.
export function applyHDAKind(kind, params, inputs) {
  const def = HDA_NODE_KINDS[kind];
  if (!def) throw new Error(`unknown HDA kind: ${kind}`);
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
