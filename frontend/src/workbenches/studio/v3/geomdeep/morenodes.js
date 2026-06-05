// ArchDisc Studio V3 — deeper Houdini-SOP-style geometry-node definitions.
//
// Twenty node kinds layered on top of the slice-684 geomnodes/ registry.
// Each entry follows the SAME shape used by geomnodes/nodes.js so the
// existing editor / graph evaluator can render and run them with no
// editor changes:
//
//   {
//     title           : string,
//     category        : string,
//     defaultParams() : object cloned per instance,
//     inputs          : [{ name, type }],
//     outputs         : [{ name, type }],
//     eval(ctx, ins)  : returns a THREE.BufferGeometry
//   }
//
// All `eval()` implementations:
//   • are pure functions of `this.params` and the resolved input Map
//   • return a fresh BufferGeometry (non-indexed where convenient)
//   • never mutate the input geometries (we ensureNonIndexed() which
//     clones), so a node feeding two consumers stays deterministic
//   • never spawn anything in the scene — that's the build-mesh step
//
// Bend / Twist / Taper mirror the existing window.__studioBendYZ /
// __studioTwistY / __studioTaperY math (api.js lines 6649-6727) but
// operate on a passed-in BufferGeometry instead of the active selection.
// Solidify / Decimate / Voxelize / Spherify / Bevel mirror their slice
// counterparts the same way. Re-implementing locally keeps the graph
// evaluator side-effect-free and means a graph can be evaluated even
// when no mesh is selected.

import * as THREE from 'three';
import {
  mergeGeometries,
  mergeVertices,
} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import { ConvexGeometry } from 'three/examples/jsm/geometries/ConvexGeometry.js';
import { mulberry32 } from '../common/random.js';
import { valueNoise3D as valueNoise } from '../common/noise.js';

// ─── Shared helpers (kept local so morenodes.js doesn't import from the
//     slice-684 geomnodes/ directory — the brief says "create NEW files
//     only, do NOT touch the existing geomnodes/ directory"). ────────
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

function bbox(geo) {
  geo.computeBoundingBox();
  return geo.boundingBox.clone();
}

// valueNoise + mulberry32 imported from common/* — single canonical
// implementation reused by api.js, shader, modstack, geomtotal, etc.

// Parse "#aabbcc" or "0xaabbcc" or a 0xRRGGBB number → {r,g,b} 0..1.
function parseColor(c) {
  const col = new THREE.Color();
  try {
    if (typeof c === 'number') col.setHex(c >>> 0);
    else if (typeof c === 'string' && c.length) col.set(c);
    else col.setHex(0xffffff);
  } catch (_) { col.setHex(0xffffff); }
  return col;
}

// Apply per-vertex colour buffer to geometry (key = 'color' — three's
// MeshStandardMaterial picks it up when vertexColors: true).
function writeColorAttr(geo, perVertexRGB) {
  if (!geo.attributes.position) return geo;
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = perVertexRGB(i) || [1, 1, 1];
    arr[i * 3]     = c[0];
    arr[i * 3 + 1] = c[1];
    arr[i * 3 + 2] = c[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

// ─── 20 deeper node kinds ────────────────────────────────────────────────
export const MORE_NODE_KINDS = {

  // 1. Noise Displace — per-vertex sine-noise displacement.
  noiseDisplace: {
    title: 'Noise Displace',
    category: 'geomnodes',
    defaultParams: () => ({ amplitude: 0.15, frequency: 2.5, axis: 'normal' }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const amp = Math.max(-10, Math.min(10, +this.params.amplitude || 0.15));
      const freq = Math.max(0.0001, +this.params.frequency || 2.5);
      const axis = String(this.params.axis || 'normal');
      const pos = g.attributes.position;
      const nor = g.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        const ox = pos.getX(i), oy = pos.getY(i), oz = pos.getZ(i);
        const n = valueNoise(ox * freq, oy * freq, oz * freq) * amp;
        if (axis === 'x') pos.setX(i, ox + n);
        else if (axis === 'y') pos.setY(i, oy + n);
        else if (axis === 'z') pos.setZ(i, oz + n);
        else {
          // along vertex normal (default).
          pos.setXYZ(i, ox + nor.getX(i) * n, oy + nor.getY(i) * n, oz + nor.getZ(i) * n);
        }
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
      return g;
    },
  },

  // 2. Wrangle (ASL) — runs a per-vertex expression string against the
  //                    input geometry. Mirrors __studioRunVexExpr's safe
  //                    Function-evaluator strategy but pure on the
  //                    passed-in BufferGeometry.
  wrangle: {
    title: 'Wrangle (ASL)',
    category: 'geomnodes',
    defaultParams: () => ({
      script: '[P.x + Math.sin(P.y * 4 + t) * 0.1, P.y, P.z]',
    }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const MATH_SAFE = Object.freeze({
        sin: Math.sin, cos: Math.cos, tan: Math.tan,
        asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
        sqrt: Math.sqrt, pow: Math.pow, exp: Math.exp, log: Math.log,
        abs: Math.abs, sign: Math.sign, floor: Math.floor, ceil: Math.ceil, round: Math.round,
        min: Math.min, max: Math.max, hypot: Math.hypot,
        PI: Math.PI, E: Math.E, TAU: Math.PI * 2,
      });
      const expr = String(this.params.script || 'P');
      let fn;
      try { fn = new Function('P', 't', 'i', 'Math', '"use strict"; return (' + expr + ');'); }
      catch (_) { return g; }
      const t = (ctx && typeof ctx.now === 'number') ? (ctx.now / 1000) : 0;
      const pos = g.attributes.position;
      const P = { x: 0, y: 0, z: 0 };
      for (let i = 0; i < pos.count; i++) {
        P.x = pos.getX(i); P.y = pos.getY(i); P.z = pos.getZ(i);
        let r;
        try { r = fn(P, t, i, MATH_SAFE); } catch (_) { continue; }
        if (typeof r === 'number') pos.setX(i, r);
        else if (Array.isArray(r) && r.length === 3) pos.setXYZ(i, r[0], r[1], r[2]);
        else if (r && typeof r === 'object' && 'x' in r) pos.setXYZ(i, r.x, r.y, r.z);
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
      return g;
    },
  },

  // 3. Smooth — Laplacian smoothing, N iterations on welded topology.
  smooth: {
    title: 'Smooth',
    category: 'geomnodes',
    defaultParams: () => ({ iters: 2, factor: 0.5 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      // mergeVertices for true topological adjacency.
      const welded = mergeVertices(ensureNonIndexed(src), 1e-5);
      if (!welded.index) return ensureNonIndexed(welded);
      const iters = Math.max(0, Math.min(20, Math.floor(+this.params.iters || 2)));
      const factor = Math.max(0, Math.min(1, +this.params.factor || 0.5));
      const pos = welded.attributes.position;
      const idx = welded.index.array;
      const n = pos.count;
      // Build vertex → neighbour set.
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
            next[i * 3] = buf[i * 3]; next[i * 3 + 1] = buf[i * 3 + 1]; next[i * 3 + 2] = buf[i * 3 + 2];
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

  // 4. Tube From Line — accepts ANY geometry; treats sequential vertex
  //                     positions of its position attribute as the curve
  //                     control points, builds a TubeGeometry along the
  //                     CatmullRomCurve3.
  tubeFromLine: {
    title: 'Tube From Line',
    category: 'geomnodes',
    defaultParams: () => ({ tubeRadius: 0.08, tubularSegments: 64, radialSegments: 8, closed: false, maxPoints: 64 }),
    inputs: [{ name: 'curve', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('curve');
      if (!src) return emptyGeometry();
      const pos = src.attributes.position;
      if (!pos || pos.count < 2) return emptyGeometry();
      const cap = Math.max(2, Math.min(256, Math.floor(+this.params.maxPoints || 64)));
      // Sub-sample the input verts uniformly so we don't pass thousands
      // of control points to CatmullRomCurve3.
      const step = Math.max(1, Math.floor(pos.count / cap));
      const pts = [];
      const seen = new Set();
      for (let i = 0; i < pos.count; i += step) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const key = `${Math.round(x * 1000)}|${Math.round(y * 1000)}|${Math.round(z * 1000)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pts.push(new THREE.Vector3(x, y, z));
        if (pts.length >= cap) break;
      }
      if (pts.length < 2) return emptyGeometry();
      const closed = !!this.params.closed;
      const curve = new THREE.CatmullRomCurve3(pts, closed);
      const tubeR = Math.max(0.001, +this.params.tubeRadius || 0.08);
      const tubeSeg = Math.max(4, Math.min(512, Math.floor(+this.params.tubularSegments || 64)));
      const radSeg = Math.max(3, Math.min(32, Math.floor(+this.params.radialSegments || 8)));
      return ensureNonIndexed(new THREE.TubeGeometry(curve, tubeSeg, tubeR, radSeg, closed));
    },
  },

  // 5. Sweep — sweep a 2D profile along a curve. The profile is treated
  //            as a closed polyline in the XY plane (we use the first
  //            ring of vertices). The curve uses CatmullRomCurve3 through
  //            the curve input's vertices. We frame each station with the
  //            curve's tangent + a stable up vector, then weave a tube
  //            of (curveSteps × profileSteps) quads.
  sweep: {
    title: 'Sweep',
    category: 'geomnodes',
    defaultParams: () => ({ stations: 32, closeProfile: true }),
    inputs: [
      { name: 'profile', type: 'geometry' },
      { name: 'curve', type: 'geometry' },
    ],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const prof = ins.get('profile');
      const cur = ins.get('curve');
      if (!prof || !cur) return emptyGeometry();
      if (!prof.attributes.position || prof.attributes.position.count < 3) return emptyGeometry();
      if (!cur.attributes.position || cur.attributes.position.count < 2) return emptyGeometry();

      // Profile ring: take XY-plane projection of distinct verts (cap at 64).
      const profPos = prof.attributes.position;
      const ringSeen = new Set();
      const ring2D = [];
      for (let i = 0; i < profPos.count && ring2D.length < 64; i++) {
        const x = profPos.getX(i), y = profPos.getY(i);
        const key = `${Math.round(x * 1000)}|${Math.round(y * 1000)}`;
        if (ringSeen.has(key)) continue;
        ringSeen.add(key);
        ring2D.push([x, y]);
      }
      if (ring2D.length < 3) return emptyGeometry();

      // Curve points: sub-sampled distinct verts.
      const curPos = cur.attributes.position;
      const curveSeen = new Set();
      const curveVecs = [];
      const stepCap = Math.max(2, Math.min(256, Math.floor(+this.params.stations || 32)));
      const step = Math.max(1, Math.floor(curPos.count / stepCap));
      for (let i = 0; i < curPos.count && curveVecs.length < stepCap; i += step) {
        const x = curPos.getX(i), y = curPos.getY(i), z = curPos.getZ(i);
        const key = `${Math.round(x * 1000)}|${Math.round(y * 1000)}|${Math.round(z * 1000)}`;
        if (curveSeen.has(key)) continue;
        curveSeen.add(key);
        curveVecs.push(new THREE.Vector3(x, y, z));
      }
      if (curveVecs.length < 2) return emptyGeometry();

      const path = new THREE.CatmullRomCurve3(curveVecs, false);
      const stations = Math.max(2, Math.min(256, Math.floor(+this.params.stations || 32)));
      // Parallel-transport frames so the profile doesn't twist wildly.
      const frames = path.computeFrenetFrames(stations - 1, false);

      // Per-station ring of N world-space points.
      const N = ring2D.length;
      const stationsCount = stations;
      const all = new Array(stationsCount); // each = Array<Vector3> of length N
      for (let s = 0; s < stationsCount; s++) {
        const t = s / (stationsCount - 1);
        const center = path.getPointAt(t);
        const normal = frames.normals[s] || new THREE.Vector3(1, 0, 0);
        const binor  = frames.binormals[s] || new THREE.Vector3(0, 1, 0);
        const ring = new Array(N);
        for (let k = 0; k < N; k++) {
          const px = ring2D[k][0], py = ring2D[k][1];
          ring[k] = new THREE.Vector3(
            center.x + normal.x * px + binor.x * py,
            center.y + normal.y * px + binor.y * py,
            center.z + normal.z * px + binor.z * py,
          );
        }
        all[s] = ring;
      }

      // Stitch quads → 2 tris per (station × profileEdge).
      const closeProfile = !!this.params.closeProfile;
      const edgeMax = closeProfile ? N : N - 1;
      const triCount = (stationsCount - 1) * edgeMax * 2;
      const arr = new Float32Array(triCount * 9);
      let o = 0;
      for (let s = 0; s < stationsCount - 1; s++) {
        for (let k = 0; k < edgeMax; k++) {
          const k1 = (k + 1) % N;
          const a = all[s][k];     const b = all[s + 1][k];
          const c = all[s + 1][k1]; const d = all[s][k1];
          // tri 1: a, b, c
          arr[o++] = a.x; arr[o++] = a.y; arr[o++] = a.z;
          arr[o++] = b.x; arr[o++] = b.y; arr[o++] = b.z;
          arr[o++] = c.x; arr[o++] = c.y; arr[o++] = c.z;
          // tri 2: a, c, d
          arr[o++] = a.x; arr[o++] = a.y; arr[o++] = a.z;
          arr[o++] = c.x; arr[o++] = c.y; arr[o++] = c.z;
          arr[o++] = d.x; arr[o++] = d.y; arr[o++] = d.z;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      g.computeVertexNormals();
      return g;
    },
  },

  // 6. Lattice Deform — bind a mesh to a 2×2×2 control lattice (the 8
  //                     corners of its bounding box) and warp each vert
  //                     by the trilinear interpolation of those corners'
  //                     offsets. Default offsets pinch +X corners inward
  //                     so an unmodified node still produces a visible
  //                     deformation.
  latticeDeform: {
    title: 'Lattice Deform',
    category: 'geomnodes',
    defaultParams: () => ({
      // 8 corners, indexed [z][y][x] flat → 24 floats (8×3).
      offsets: [
        [0, 0, 0], [-0.2, 0, 0],
        [0, 0, 0], [-0.2, 0, 0],
        [0, 0, 0], [-0.2, 0, 0],
        [0, 0, 0], [-0.2, 0, 0],
      ],
    }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const bb = bbox(g);
      const sx = Math.max(1e-6, bb.max.x - bb.min.x);
      const sy = Math.max(1e-6, bb.max.y - bb.min.y);
      const sz = Math.max(1e-6, bb.max.z - bb.min.z);
      const off = Array.isArray(this.params.offsets) ? this.params.offsets : [];
      // Pad / clip to exactly 8.
      const corners = new Array(8);
      for (let i = 0; i < 8; i++) corners[i] = toVec3(off[i], [0, 0, 0]);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const u = (x - bb.min.x) / sx;
        const v = (y - bb.min.y) / sy;
        const w = (z - bb.min.z) / sz;
        // Trilinear blend of 8 corner offsets — corner index
        // c000=0, c100=1, c010=2, c110=3, c001=4, c101=5, c011=6, c111=7
        const ox =
          (1 - u) * (1 - v) * (1 - w) * corners[0][0] +
          u       * (1 - v) * (1 - w) * corners[1][0] +
          (1 - u) * v       * (1 - w) * corners[2][0] +
          u       * v       * (1 - w) * corners[3][0] +
          (1 - u) * (1 - v) * w       * corners[4][0] +
          u       * (1 - v) * w       * corners[5][0] +
          (1 - u) * v       * w       * corners[6][0] +
          u       * v       * w       * corners[7][0];
        const oy =
          (1 - u) * (1 - v) * (1 - w) * corners[0][1] +
          u       * (1 - v) * (1 - w) * corners[1][1] +
          (1 - u) * v       * (1 - w) * corners[2][1] +
          u       * v       * (1 - w) * corners[3][1] +
          (1 - u) * (1 - v) * w       * corners[4][1] +
          u       * (1 - v) * w       * corners[5][1] +
          (1 - u) * v       * w       * corners[6][1] +
          u       * v       * w       * corners[7][1];
        const oz =
          (1 - u) * (1 - v) * (1 - w) * corners[0][2] +
          u       * (1 - v) * (1 - w) * corners[1][2] +
          (1 - u) * v       * (1 - w) * corners[2][2] +
          u       * v       * (1 - w) * corners[3][2] +
          (1 - u) * (1 - v) * w       * corners[4][2] +
          u       * (1 - v) * w       * corners[5][2] +
          (1 - u) * v       * w       * corners[6][2] +
          u       * v       * w       * corners[7][2];
        pos.setXYZ(i, x + ox, y + oy, z + oz);
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
      return g;
    },
  },

  // 7. Bend — bend along the Y axis in the YZ plane (mirrors
  //           window.__studioBendYZ).
  bend: {
    title: 'Bend',
    category: 'geomnodes',
    defaultParams: () => ({ degrees: 45 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const bb = bbox(g);
      const yMid = (bb.min.y + bb.max.y) / 2;
      const ext = Math.max(1e-6, bb.max.y - bb.min.y);
      const rad = (Number(this.params.degrees) || 0) * Math.PI / 180;
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const t = (y - yMid) / ext;
        const a = t * rad;
        const cy = Math.cos(a), sy = Math.sin(a);
        pos.setXYZ(i, x, y * cy - z * sy, y * sy + z * cy);
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
      return g;
    },
  },

  // 8. Twist — twist around the Y axis (mirrors window.__studioTwistY).
  twist: {
    title: 'Twist',
    category: 'geomnodes',
    defaultParams: () => ({ degrees: 90 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const bb = bbox(g);
      const ext = Math.max(1e-6, bb.max.y - bb.min.y);
      const rad = (Number(this.params.degrees) || 0) * Math.PI / 180;
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const t = (y - bb.min.y) / ext;
        const a = t * rad;
        const cx = Math.cos(a), sx = Math.sin(a);
        pos.setXYZ(i, x * cx - z * sx, y, x * sx + z * cx);
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
      return g;
    },
  },

  // 9. Taper — narrow / widen the top vs bottom along Y (mirrors
  //            window.__studioTaperY).
  taper: {
    title: 'Taper',
    category: 'geomnodes',
    defaultParams: () => ({ topRatio: 0.5 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const bb = bbox(g);
      const ext = Math.max(1e-6, bb.max.y - bb.min.y);
      const r = Math.max(0.01, Number(this.params.topRatio) || 1);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const t = (y - bb.min.y) / ext;
        const sc = 1 + (r - 1) * t;
        pos.setXYZ(i, x * sc, y, z * sc);
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
      return g;
    },
  },

  // 10. Mountain — layered fBM noise displacement along the vertex normal
  //                for a terrain / landscape feel.
  mountain: {
    title: 'Mountain',
    category: 'geomnodes',
    defaultParams: () => ({ amplitude: 0.3, frequency: 1.5, octaves: 4, lacunarity: 2.0, gain: 0.5 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const amp = Math.max(0, Math.min(20, +this.params.amplitude || 0.3));
      const freq = Math.max(0.0001, +this.params.frequency || 1.5);
      const oct = Math.max(1, Math.min(8, Math.floor(+this.params.octaves || 4)));
      const lac = Math.max(1.0001, +this.params.lacunarity || 2.0);
      const gain = Math.max(0, Math.min(1, +this.params.gain || 0.5));
      const pos = g.attributes.position;
      const nor = g.attributes.normal;
      for (let i = 0; i < pos.count; i++) {
        const ox = pos.getX(i), oy = pos.getY(i), oz = pos.getZ(i);
        let f = freq, a = amp, sum = 0;
        for (let k = 0; k < oct; k++) {
          sum += valueNoise(ox * f, oy * f, oz * f) * a;
          f *= lac;
          a *= gain;
        }
        pos.setXYZ(
          i,
          ox + nor.getX(i) * sum,
          oy + nor.getY(i) * sum,
          oz + nor.getZ(i) * sum,
        );
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
      return g;
    },
  },

  // 11. Bevel Geometry — chamfer sharp edges over a dihedral threshold.
  //                      Self-contained implementation (does NOT call
  //                      __studioEditBevel since that requires an active
  //                      selection — graphs must be selection-free).
  bevelGeom: {
    title: 'Bevel Geometry',
    category: 'geomnodes',
    defaultParams: () => ({ distance: 0.08, segments: 2 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const d = Math.max(0.0001, +this.params.distance || 0.05);
      // Approach: shrink each vertex slightly toward the geometric
      // centroid, weighted by the local sharpness (1 - dot of avg face
      // normal with surface normal). Then weld to remove now-overlapping
      // verts. Produces a visible chamfer suitable for downstream
      // graph nodes; an exact corner-extruded bevel is the editops.js
      // job (which mutates the active mesh).
      const welded = mergeVertices(ensureNonIndexed(src), 1e-5);
      welded.computeVertexNormals();
      const pos = welded.attributes.position;
      const nor = welded.attributes.normal;
      welded.computeBoundingSphere();
      const cen = welded.boundingSphere.center;
      const rad = welded.boundingSphere.radius || 1;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
        // Vector to centroid (normalized).
        const dx = cen.x - x, dy = cen.y - y, dz = cen.z - z;
        const dlen = Math.hypot(dx, dy, dz) || 1;
        const ux = dx / dlen, uy = dy / dlen, uz = dz / dlen;
        // Sharpness = 1 - |dot(n, u)|. Flat regions ≈ 0, corners ≈ 1.
        const dot = Math.abs(nx * ux + ny * uy + nz * uz);
        const sharp = 1 - dot;
        const k = d * sharp / Math.max(rad * 0.1, 0.1);
        pos.setXYZ(i, x + ux * k * rad, y + uy * k * rad, z + uz * k * rad);
      }
      pos.needsUpdate = true;
      welded.computeVertexNormals();
      return welded;
    },
  },

  // 12. Solidify Geometry — adds a back-face shell at -thickness along
  //                         the vertex normal. Doubles vert count.
  //                         Mirrors __studioSolidify.
  solidifyGeom: {
    title: 'Solidify Geometry',
    category: 'geomnodes',
    defaultParams: () => ({ thickness: 0.05 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const flat = ensureNonIndexed(src);
      flat.computeVertexNormals();
      const t = Number(this.params.thickness) || 0.05;
      const sPos = flat.attributes.position.array;
      const sN = flat.attributes.normal.array;
      const tris = sPos.length / 9;
      const out = new Float32Array(tris * 2 * 9);
      out.set(sPos, 0);
      for (let i = 0; i < tris; i++) {
        const off = tris * 9 + i * 9;
        const s = i * 9;
        for (let k = 2, w = 0; k >= 0; k--, w++) {
          out[off + w * 3]     = sPos[s + k * 3]     - sN[s + k * 3]     * t;
          out[off + w * 3 + 1] = sPos[s + k * 3 + 1] - sN[s + k * 3 + 1] * t;
          out[off + w * 3 + 2] = sPos[s + k * 3 + 2] - sN[s + k * 3 + 2] * t;
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(out, 3));
      g.computeVertexNormals();
      return g;
    },
  },

  // 13. Decimate Geometry — simplify by ratio using three's SimplifyModifier.
  //                         `ratio` = fraction to KEEP (0.5 → drop half).
  decimateGeom: {
    title: 'Decimate Geometry',
    category: 'geomnodes',
    defaultParams: () => ({ ratio: 0.5 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const merged = mergeVertices(ensureNonIndexed(src), 1e-4);
      const before = merged.attributes.position.count;
      const keep = Math.max(0.05, Math.min(0.95, Number(this.params.ratio) || 0.5));
      const remove = Math.floor(before * (1 - keep));
      try {
        const out = new SimplifyModifier().modify(merged, remove);
        out.computeVertexNormals();
        return out;
      } catch (_) {
        return ensureNonIndexed(src);
      }
    },
  },

  // 14. Voxelize Geometry — snap each vert to nearest grid cell.
  voxelizeGeom: {
    title: 'Voxelize Geometry',
    category: 'geomnodes',
    defaultParams: () => ({ size: 0.1 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const s = Math.max(1e-5, Number(this.params.size) || 0.1);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.array.length; i++) pos.array[i] = Math.round(pos.array[i] / s) * s;
      pos.needsUpdate = true;
      g.computeVertexNormals();
      return g;
    },
  },

  // 15. Spherify Geometry — project every vert onto a sphere of `radius`.
  spherifyGeom: {
    title: 'Spherify Geometry',
    category: 'geomnodes',
    defaultParams: () => ({ radius: 1.0 }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const r = Number(this.params.radius) || 1.0;
      const pos = g.attributes.position;
      const tmp = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        tmp.fromArray(pos.array, i * 3);
        const len = tmp.length() || 1e-6;
        pos.array[i * 3]     = tmp.x / len * r;
        pos.array[i * 3 + 1] = tmp.y / len * r;
        pos.array[i * 3 + 2] = tmp.z / len * r;
      }
      pos.needsUpdate = true;
      g.computeVertexNormals();
      return g;
    },
  },

  // 16. Color Attribute — assign a flat hex colour to every vertex.
  colorAttr: {
    title: 'Color Attribute',
    category: 'geomnodes',
    defaultParams: () => ({ color: '#8bbcd6' }),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const col = parseColor(this.params.color);
      const rgb = [col.r, col.g, col.b];
      return writeColorAttr(g, () => rgb);
    },
  },

  // 17. Color From Position — each vert's RGB = normalized world position
  //                            within the bounding box.
  colorFromPos: {
    title: 'Color From Position',
    category: 'geomnodes',
    defaultParams: () => ({}),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const g = ensureNonIndexed(src);
      const bb = bbox(g);
      const sx = Math.max(1e-6, bb.max.x - bb.min.x);
      const sy = Math.max(1e-6, bb.max.y - bb.min.y);
      const sz = Math.max(1e-6, bb.max.z - bb.min.z);
      const pos = g.attributes.position;
      return writeColorAttr(g, (i) => [
        (pos.getX(i) - bb.min.x) / sx,
        (pos.getY(i) - bb.min.y) / sy,
        (pos.getZ(i) - bb.min.z) / sz,
      ]);
    },
  },

  // 18. Scatter On Surface — distribute N copies of A onto random points
  //                          on B's surface. Triangle-area-weighted (so
  //                          large tris receive proportionally more
  //                          samples). Deterministic via seed.
  scatterOnSurface: {
    title: 'Scatter On Surface',
    category: 'geomnodes',
    defaultParams: () => ({ count: 32, seed: 1, alignToNormal: false }),
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
      const bPos = B.attributes.position;
      if (!bPos || bPos.count < 3) return emptyGeometry();
      const triCount = bPos.count / 3;

      // Build cumulative-area table.
      const areas = new Float64Array(triCount);
      let total = 0;
      const v0 = new THREE.Vector3(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
      const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
      for (let t = 0; t < triCount; t++) {
        v0.fromArray(bPos.array, t * 9);
        v1.fromArray(bPos.array, t * 9 + 3);
        v2.fromArray(bPos.array, t * 9 + 6);
        e1.subVectors(v1, v0); e2.subVectors(v2, v0);
        nrm.crossVectors(e1, e2);
        const area = nrm.length() * 0.5;
        total += area;
        areas[t] = total;
      }
      if (total <= 0) return emptyGeometry();

      const N = Math.max(1, Math.min(512, Math.floor(+this.params.count || 32)));
      const seed = (Number(this.params.seed) | 0) || 1;
      const rng = mulberry32(seed * 9901);
      const alignNor = !!this.params.alignToNormal;

      const upY = new THREE.Vector3(0, 1, 0);
      const geos = [];
      for (let s = 0; s < N; s++) {
        // Pick triangle by cumulative area.
        const r = rng() * total;
        // Binary search.
        let lo = 0, hi = triCount - 1;
        while (lo < hi) {
          const mid = (lo + hi) >>> 1;
          if (areas[mid] < r) lo = mid + 1; else hi = mid;
        }
        const t = lo;
        // Barycentric random point.
        let u = rng(), w = rng();
        if (u + w > 1) { u = 1 - u; w = 1 - w; }
        const vv = 1 - u - w;
        v0.fromArray(bPos.array, t * 9);
        v1.fromArray(bPos.array, t * 9 + 3);
        v2.fromArray(bPos.array, t * 9 + 6);
        const px = v0.x * vv + v1.x * u + v2.x * w;
        const py = v0.y * vv + v1.y * u + v2.y * w;
        const pz = v0.z * vv + v1.z * u + v2.z * w;

        const clone = ensureNonIndexed(A);
        const m = new THREE.Matrix4();
        if (alignNor) {
          e1.subVectors(v1, v0); e2.subVectors(v2, v0);
          nrm.crossVectors(e1, e2).normalize();
          const q = new THREE.Quaternion().setFromUnitVectors(upY, nrm);
          m.compose(new THREE.Vector3(px, py, pz), q, new THREE.Vector3(1, 1, 1));
        } else {
          m.makeTranslation(px, py, pz);
        }
        clone.applyMatrix4(m);
        geos.push(clone);
      }
      if (!geos.length) return emptyGeometry();
      const merged = mergeGeometries(geos, false) || geos[0];
      if (!merged.attributes.normal) merged.computeVertexNormals();
      return merged;
    },
  },

  // 19. Convex Hull — gift-wrap hull of input verts via three's
  //                   ConvexGeometry (which is bundled under
  //                   three/examples/jsm/geometries/).
  convexHull: {
    title: 'Convex Hull',
    category: 'geomnodes',
    defaultParams: () => ({}),
    inputs: [{ name: 'geometry', type: 'geometry' }],
    outputs: [{ name: 'geometry', type: 'geometry' }],
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return emptyGeometry();
      const pos = src.attributes && src.attributes.position;
      if (!pos || pos.count < 4) return emptyGeometry();
      // Sub-sample up to 1024 distinct vertices so we don't choke
      // ConvexGeometry on a million-vertex blob.
      const cap = 1024;
      const seen = new Set();
      const pts = [];
      const step = Math.max(1, Math.floor(pos.count / cap));
      for (let i = 0; i < pos.count && pts.length < cap; i += step) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const key = `${Math.round(x * 1000)}|${Math.round(y * 1000)}|${Math.round(z * 1000)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pts.push(new THREE.Vector3(x, y, z));
      }
      if (pts.length < 4) return emptyGeometry();
      try {
        const g = new ConvexGeometry(pts);
        return ensureNonIndexed(g);
      } catch (_) {
        return emptyGeometry();
      }
    },
  },

  // 20. Merge — three.js BufferGeometryUtils.mergeGeometries(A, B).
  merge: {
    title: 'Merge',
    category: 'geomnodes',
    defaultParams: () => ({}),
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
      const A = ensureNonIndexed(a);
      const B = ensureNonIndexed(b);
      const merged = mergeGeometries([A, B], false) || A;
      if (!merged.attributes.normal) merged.computeVertexNormals();
      return merged;
    },
  },
};

// Public iteration list.
export function listMoreKinds() {
  return Object.keys(MORE_NODE_KINDS);
}

// Stand-alone applicator: given a kind name, a params object and an
// inputs Map (or plain object) of name → BufferGeometry, run the eval
// and return the resulting BufferGeometry. Used by __studioGeomDeepApply.
export function applyMoreKind(kind, params, inputs) {
  const def = MORE_NODE_KINDS[kind];
  if (!def) throw new Error(`unknown geom-deep kind: ${kind}`);
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
