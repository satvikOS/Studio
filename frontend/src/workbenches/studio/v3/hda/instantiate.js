// ArchDisc Studio V3 — HDA: instantiate a packed sub-graph.
//
// `instantiate(assetName, paramOverrides)` reads the HDA from
// localStorage, applies the override params to the exposed-param map,
// runs an evaluator over the union of every node table we can see, and
// returns the resulting THREE.BufferGeometry along with a fresh
// THREE.Mesh added to `window.__archdiscScene` (so the mesh is visible
// and discoverable by Outliner / save-scene / selection helpers).
//
// We deliberately do NOT import geomnodes/graph.js's `evaluate` — that
// function's closure-bound NODE_KINDS table only contains slice-684's
// 8 kinds, so it would fail to run any geomdeep / geomtotal / HDA kind
// referenced by a packed sub-graph. Instead this module walks the
// graph itself and resolves each node's kind against a "union table"
// built from:
//
//   1. window.__studioHDANodes        (HDA's 15 kinds)
//   2. window.__studioGeomTotalNodes  (slice-693 30 kinds)
//   3. window.__studioGeomDeepNodes   (slice-688 20 kinds)
//   4. The slice-684 8 kinds, looked up via __studioGeomNodeAdd as a
//      probe + a tiny inline table for the eight kinds we know about.
//
// The slice-684 inline mirror lives below because we can't import the
// slice-684 NODE_KINDS table without violating the brief constraint
// (do NOT touch existing geomnodes/). The mirror is read-only and
// covers ONLY the 8 base kinds that any HDA can rely on existing.

import * as THREE from 'three';
import {
  unpackAsset,
  applyOverrides,
} from './asset.js';
import { HDA_NODE_KINDS } from './nodes.js';

// ─── Inline mirror of the slice-684 NODE_KINDS table ────────────────────
// This is a separate file from geomnodes/nodes.js — we intentionally
// re-implement the 8 base kinds locally so instantiate.js can evaluate
// a packed HDA that uses them without violating the "don't touch
// geomnodes/" constraint. The maths matches slice-684 line-for-line.
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../common/random.js';
import { simpleSplitSubdivide } from '../common/subdivide.js';

function _ensureNonIndexed(geo) {
  if (!geo) return null;
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  if (!g.attributes.normal) g.computeVertexNormals();
  return g;
}

function _emptyGeometry() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  return g;
}

function _toVec3(v, fallback) {
  if (Array.isArray(v) && v.length >= 3) return [+v[0] || 0, +v[1] || 0, +v[2] || 0];
  if (typeof v === 'number') return [v, v, v];
  return fallback ? fallback.slice() : [0, 0, 0];
}

const BASE_NODE_KINDS = {
  primitive: {
    title: 'Primitive',
    inputs: [],
    outputs: [{ name: 'geometry' }],
    defaultParams: () => ({
      shape: 'box',
      sizeX: 1, sizeY: 1, sizeZ: 1,
      radius: 0.5, height: 1, segments: 16, tubeRadius: 0.2,
    }),
    eval() {
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
      return _ensureNonIndexed(geo);
    },
  },
  transform: {
    title: 'Transform',
    inputs: [{ name: 'geometry' }],
    outputs: [{ name: 'geometry' }],
    defaultParams: () => ({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }),
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return _emptyGeometry();
      const geo = _ensureNonIndexed(src);
      const p = this.params || {};
      const pos = _toVec3(p.position, [0, 0, 0]);
      const rot = _toVec3(p.rotation, [0, 0, 0]);
      const scl = _toVec3(p.scale, [1, 1, 1]);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], 'XYZ'));
      m.compose(
        new THREE.Vector3(pos[0], pos[1], pos[2]),
        q,
        new THREE.Vector3(scl[0], scl[1], scl[2]),
      );
      geo.applyMatrix4(m);
      return geo;
    },
  },
  subdivide: {
    title: 'Subdivide',
    inputs: [{ name: 'geometry' }],
    outputs: [{ name: 'geometry' }],
    defaultParams: () => ({ iters: 1 }),
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return _emptyGeometry();
      const n = Math.max(0, Math.min(4, Math.floor(+this.params.iters || 1)));
      return simpleSplitSubdivide(_ensureNonIndexed(src), n);
    },
  },
  array: {
    title: 'Array',
    inputs: [{ name: 'geometry' }],
    outputs: [{ name: 'geometry' }],
    defaultParams: () => ({ count: 4, offsetXYZ: [1.2, 0, 0] }),
    eval(ctx, ins) {
      const src = ins.get('geometry');
      if (!src) return _emptyGeometry();
      const count = Math.max(1, Math.min(256, Math.floor(+this.params.count || 1)));
      const off = _toVec3(this.params.offsetXYZ, [1, 0, 0]);
      const geos = [];
      for (let i = 0; i < count; i++) {
        const clone = _ensureNonIndexed(src);
        clone.applyMatrix4(new THREE.Matrix4().makeTranslation(off[0] * i, off[1] * i, off[2] * i));
        geos.push(clone);
      }
      const merged = mergeGeometries(geos, false) || geos[0] || _emptyGeometry();
      if (!merged.attributes.normal) merged.computeVertexNormals();
      return merged;
    },
  },
  boolean: {
    title: 'Boolean',
    inputs: [{ name: 'A' }, { name: 'B' }],
    outputs: [{ name: 'geometry' }],
    defaultParams: () => ({ op: 'union' }),
    eval(ctx, ins) {
      const a = ins.get('A'), b = ins.get('B');
      if (!a && !b) return _emptyGeometry();
      if (!a) return _ensureNonIndexed(b);
      if (!b) return _ensureNonIndexed(a);
      const A = _ensureNonIndexed(a), B = _ensureNonIndexed(b);
      const op = String(this.params.op || 'union');
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
      if (op === 'difference') pieces = [A, shrink(B, 0.95)];
      else if (op === 'intersect') pieces = [shrink(A, 0.95), shrink(B, 0.95)];
      else pieces = [A, B];
      const merged = mergeGeometries(pieces, false) || pieces[0];
      if (!merged.attributes.normal) merged.computeVertexNormals();
      return merged;
    },
  },
  curve: {
    title: 'Curve',
    inputs: [],
    outputs: [{ name: 'geometry' }],
    defaultParams: () => ({
      points: [
        [-1, 0, 0], [-0.3, 0.7, 0.4], [0.6, -0.4, -0.3], [1.2, 0.2, 0.6],
      ],
      tubeRadius: 0.08, tubularSegments: 64, radialSegments: 8, closed: false,
    }),
    eval() {
      const p = this.params || {};
      const pts = Array.isArray(p.points) && p.points.length >= 2 ? p.points : [[-1, 0, 0], [1, 0, 0]];
      const vec = pts.map((q) => new THREE.Vector3(+q[0] || 0, +q[1] || 0, +q[2] || 0));
      const curve = new THREE.CatmullRomCurve3(vec, !!p.closed);
      const tubeR = Math.max(0.001, +p.tubeRadius || 0.08);
      const tubeSeg = Math.max(4, Math.min(512, Math.floor(+p.tubularSegments || 64)));
      const radSeg = Math.max(3, Math.min(32, Math.floor(+p.radialSegments || 8)));
      return _ensureNonIndexed(new THREE.TubeGeometry(curve, tubeSeg, tubeR, radSeg, !!p.closed));
    },
  },
  distribute: {
    title: 'Distribute',
    inputs: [{ name: 'A' }, { name: 'B' }],
    outputs: [{ name: 'geometry' }],
    defaultParams: () => ({ density: 0.1, seed: 1 }),
    eval(ctx, ins) {
      const a = ins.get('A'), b = ins.get('B');
      if (!a || !b) return _emptyGeometry();
      const A = _ensureNonIndexed(a), B = _ensureNonIndexed(b);
      const density = Math.max(0, Math.min(1, +this.params.density || 0.1));
      const seed = (Number(this.params.seed) | 0) || 1;
      const rand = mulberry32(seed * 1031);
      const geos = [];
      const pos = B.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        if (rand() < density) {
          const clone = _ensureNonIndexed(A);
          clone.applyMatrix4(new THREE.Matrix4().makeTranslation(pos.getX(i), pos.getY(i), pos.getZ(i)));
          geos.push(clone);
        }
      }
      if (!geos.length) return _emptyGeometry();
      const merged = mergeGeometries(geos, false) || geos[0];
      if (!merged.attributes.normal) merged.computeVertexNormals();
      return merged;
    },
  },
  output: {
    title: 'Output',
    inputs: [{ name: 'geometry' }],
    outputs: [],
    defaultParams: () => ({}),
    eval(ctx, ins) {
      return ins.get('geometry') || _emptyGeometry();
    },
  },
};

// ─── Union-table builder ────────────────────────────────────────────────
//
// Look up node kinds across HDA + geomtotal + geomdeep + base. Caller
// can pass an extra `extra` object for ad-hoc test injection.
export function buildUnionTable(extra) {
  const out = {};
  // Start with base so they're overridable by later layers if a slice
  // ever decides to ship an improved variant.
  Object.assign(out, BASE_NODE_KINDS);
  if (typeof window !== 'undefined') {
    if (window.__studioGeomDeepNodes) Object.assign(out, window.__studioGeomDeepNodes);
    if (window.__studioGeomTotalNodes) Object.assign(out, window.__studioGeomTotalNodes);
    if (window.__studioHDANodes) Object.assign(out, window.__studioHDANodes);
  }
  // Inline HDA kinds — always present since this module imports them.
  Object.assign(out, HDA_NODE_KINDS);
  if (extra && typeof extra === 'object') Object.assign(out, extra);
  return out;
}

// ─── Sub-graph evaluator ────────────────────────────────────────────────
//
// Walks `nodes`/`wires` (the flat-array shape returned by unpackAsset)
// and runs each node's eval() with the union table. Returns the
// BufferGeometry that flows into the (first) `output` kind node — or,
// if there's no `output` node, the result of the LAST node in
// declaration order.
export function evaluateSubgraph(subgraph, opts) {
  const table = (opts && opts.table) || buildUnionTable();
  const nodes = (subgraph && Array.isArray(subgraph.nodes)) ? subgraph.nodes : [];
  const wires = (subgraph && Array.isArray(subgraph.wires)) ? subgraph.wires : [];
  if (!nodes.length) return null;
  const byId = new Map();
  for (const n of nodes) byId.set(n.id, n);

  const cache = new Map();
  const stack = new Set();
  const ctx = {
    now: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(),
  };

  function evalOne(id) {
    if (cache.has(id)) return cache.get(id);
    if (stack.has(id)) return null;
    stack.add(id);
    const node = byId.get(id);
    if (!node) { stack.delete(id); return null; }
    const def = table[node.kind];
    if (!def) { stack.delete(id); cache.set(id, null); return null; }
    const ins = new Map();
    for (const inSlot of (def.inputs || [])) {
      const wire = wires.find((w) => w.dstId === id && w.dstIn === inSlot.name);
      if (wire) {
        const upstream = evalOne(wire.srcId);
        ins.set(inSlot.name, upstream);
      } else if (inSlot.default !== undefined) {
        ins.set(inSlot.name, inSlot.default);
      }
    }
    let value = null;
    try {
      value = def.eval.call(node, ctx, ins);
    } catch (e) {
      value = null;
    }
    cache.set(id, value);
    stack.delete(id);
    return value;
  }

  // Output kind preferred; else the last node in declaration order.
  let outId = null;
  for (const n of nodes) if (n.kind === 'output') { outId = n.id; break; }
  if (!outId) outId = nodes[nodes.length - 1].id;
  return evalOne(outId);
}

// ─── Public instantiate ─────────────────────────────────────────────────

/**
 * instantiate(assetName, paramOverrides) — read the HDA from
 * localStorage, apply overrides, evaluate the sub-graph, build a fresh
 * THREE.Mesh, add it to `window.__archdiscScene` and return:
 *
 *   { ok, uuid, verts, name, kindsUsed }
 *
 * On failure returns `{ ok: false, error }`.
 */
export function instantiate(assetName, paramOverrides) {
  const unpacked = unpackAsset(assetName);
  if (!unpacked.ok) return { ok: false, error: unpacked.error };
  const merged = applyOverrides(unpacked.subgraph, unpacked.exposedParams, paramOverrides);
  const geo = evaluateSubgraph(merged);
  if (!geo || !geo.attributes || !geo.attributes.position ||
      geo.attributes.position.count === 0) {
    return { ok: false, error: 'sub-graph produced no geometry' };
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const scene = (typeof window !== 'undefined') ? window.__archdiscScene : null;
  if (!scene) {
    // No scene available — return the geometry so callers in tests can
    // still consume it.
    return {
      ok: true,
      uuid: null,
      name: assetName,
      verts: geo.attributes.position.count,
      geometry: geo,
      kindsUsed: merged.nodes.map((n) => n.kind),
      note: 'no __archdiscScene; geometry returned in-memory only',
    };
  }
  const mat = new THREE.MeshStandardMaterial({
    color: 0x9cc7e0, roughness: 0.55, metalness: 0.12,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'hda-' + assetName;
  mesh.userData = mesh.userData || {};
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'hda-instance';
  mesh.userData.archdiscStudioHDAName = assetName;
  scene.add(mesh);
  if (typeof window !== 'undefined' && typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(mesh); } catch (_) {}
  }
  if (typeof window !== 'undefined' && typeof window.__studioPushUndo === 'function') {
    try { window.__studioPushUndo('hda-instantiate'); } catch (_) {}
  }
  return {
    ok: true,
    uuid: mesh.uuid,
    name: assetName,
    verts: geo.attributes.position.count,
    kindsUsed: merged.nodes.map((n) => n.kind),
  };
}
