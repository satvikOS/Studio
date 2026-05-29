/*
 * Studio Geometry Node Graph — evaluation engine (pure, no React).
 *
 * A Houdini SOP / Blender Geometry Nodes / Grasshopper-style DAG: nodes produce
 * THREE.BufferGeometry, wired output->input; the graph is topologically sorted
 * and evaluated to a final geometry. This same framework underpins the visual
 * editor (NodeGraphEditor.jsx) and is the foundation the material/shader graph
 * (Substance/Unreal) and Blueprint graph will reuse.
 *
 * Graph shape (serialisable):
 *   { nodes: [{ id, type, x, y, params:{} }],
 *     edges: [{ from:{node, port}, to:{node, port} }] }   // port = input name
 *
 * Deterministic only (no Math.random), per Studio's no-randomness rule.
 */
import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildNurbsSurfaceGeometry } from '../nurbs/nurbsSurface.js';

const S = 0.03; // PRIMITIVE_SIZE (30 mm), matches WorkbenchStudio

// ── deterministic value-noise fBm (matches the sculpt erosion scheme) ──
function hash3(ix, iy, iz) {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647) >>> 0;
  h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}
function fbm(x, y, z, oct = 4) {
  let a = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { a += amp * (vnoise(x * f, y * f, z * f) * 2 - 1); f *= 2; amp *= 0.5; }
  return a;
}

function makePrimitive(kind, size) {
  const s = S * (size || 1);
  switch (kind) {
    case 'sphere': return new THREE.SphereGeometry(s * 0.6, 32, 24);
    case 'cylinder': return new THREE.CylinderGeometry(s * 0.5, s * 0.5, s, 32);
    case 'cone': return new THREE.ConeGeometry(s * 0.55, s, 32);
    case 'torus': return new THREE.TorusGeometry(s * 0.5, s * 0.18, 16, 32);
    case 'icosahedron': return new THREE.IcosahedronGeometry(s * 0.6, 0);
    case 'cube': default: return new THREE.BoxGeometry(s, s, s);
  }
}

function weldByPosition(geo) {
  const g = geo.clone();
  g.deleteAttribute('normal'); g.deleteAttribute('uv'); g.deleteAttribute('tangent');
  try { const w = mergeVertices(g); if (w && w.attributes.position) return w; } catch { /* keep */ }
  if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
  return g;
}

function subdivideGeo(geo) {
  const g = geo.index ? geo : (() => { const c = geo.clone(); c.setIndex([...Array(c.attributes.position.count).keys()]); return c; })();
  const oldPos = g.attributes.position, oldIdx = g.index;
  const xs = [], ys = [], zs = [];
  for (let i = 0; i < oldPos.count; i++) { xs.push(oldPos.getX(i)); ys.push(oldPos.getY(i)); zs.push(oldPos.getZ(i)); }
  const edge = new Map();
  const mid = (a, b) => {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    let v = edge.get(k); if (v !== undefined) return v;
    v = xs.length; xs.push((xs[a] + xs[b]) / 2); ys.push((ys[a] + ys[b]) / 2); zs.push((zs[a] + zs[b]) / 2);
    edge.set(k, v); return v;
  };
  const ni = [];
  for (let t = 0; t < oldIdx.count; t += 3) {
    const a = oldIdx.getX(t), b = oldIdx.getX(t + 1), c = oldIdx.getX(t + 2);
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    ni.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
  }
  const arr = new Float32Array(xs.length * 3);
  for (let i = 0; i < xs.length; i++) { arr[i * 3] = xs[i]; arr[i * 3 + 1] = ys[i]; arr[i * 3 + 2] = zs[i]; }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  out.setIndex(ni); out.computeVertexNormals(); out.computeBoundingBox(); out.computeBoundingSphere();
  return out;
}

// ── node type registry: eval(inputs{}, params) -> THREE.BufferGeometry ──
export const NODE_TYPES = {
  primitive: {
    label: 'Primitive', inputs: [], outputs: ['geometry'],
    params: [{ key: 'kind', type: 'enum', options: ['cube', 'sphere', 'cylinder', 'cone', 'torus', 'icosahedron'], default: 'cube' }, { key: 'size', type: 'number', default: 1 }],
    eval: (_in, p) => makePrimitive(p.kind || 'cube', p.size == null ? 1 : p.size),
  },
  nurbs: {
    label: 'NURBS Surface', inputs: [], outputs: ['geometry'],
    params: [{ key: 'amplitude', type: 'number', default: 1.5 }, { key: 'centerWeight', type: 'number', default: 2.2 }],
    eval: (_in, p) => buildNurbsSurfaceGeometry({ amplitude: p.amplitude == null ? 1.5 : p.amplitude, centerWeight: p.centerWeight == null ? 2.2 : p.centerWeight }),
  },
  transform: {
    label: 'Transform', inputs: ['geometry'], outputs: ['geometry'],
    params: [{ key: 'tx', default: 0 }, { key: 'ty', default: 0 }, { key: 'tz', default: 0 }, { key: 'rx', default: 0 }, { key: 'ry', default: 0 }, { key: 'rz', default: 0 }, { key: 'sx', default: 1 }, { key: 'sy', default: 1 }, { key: 'sz', default: 1 }],
    eval: (inp, p) => {
      const g = inp.geometry ? inp.geometry.clone() : makePrimitive('cube', 1);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rx || 0, p.ry || 0, p.rz || 0));
      m.compose(new THREE.Vector3((p.tx || 0) * S, (p.ty || 0) * S, (p.tz || 0) * S), q, new THREE.Vector3(p.sx == null ? 1 : p.sx, p.sy == null ? 1 : p.sy, p.sz == null ? 1 : p.sz));
      g.applyMatrix4(m); g.computeVertexNormals(); g.computeBoundingBox();
      return g;
    },
  },
  subdivide: {
    label: 'Subdivide', inputs: ['geometry'], outputs: ['geometry'],
    params: [{ key: 'iterations', type: 'number', default: 1 }],
    eval: (inp, p) => {
      let g = weldByPosition(inp.geometry || makePrimitive('cube', 1));
      const n = Math.max(0, Math.min(3, Math.floor(p.iterations == null ? 1 : p.iterations)));
      for (let i = 0; i < n; i++) g = subdivideGeo(g);
      return g;
    },
  },
  bevel: {
    label: 'Bevel', inputs: ['geometry'], outputs: ['geometry'],
    params: [{ key: 'amount', type: 'number', default: 0.3 }],
    eval: (inp, p) => {
      let g = weldByPosition(inp.geometry || makePrimitive('cube', 1));
      let guard = 0;
      while (g.attributes.position.count < 150 && guard < 2) { g = subdivideGeo(g); guard++; }
      const pos = g.attributes.position, idx = g.index;
      const a0 = Math.max(0, Math.min(1, p.amount == null ? 0.3 : p.amount));
      g.computeBoundingBox();
      const size0 = new THREE.Vector3(); g.boundingBox.getSize(size0);
      const c0 = new THREE.Vector3(); g.boundingBox.getCenter(c0);
      const sums = new Float32Array(pos.count * 3), counts = new Int32Array(pos.count);
      const tri = [[0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1]];
      for (let t = 0; t < idx.count; t += 3) { const a = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)]; for (const [i, j] of tri) { sums[a[i] * 3] += pos.getX(a[j]); sums[a[i] * 3 + 1] += pos.getY(a[j]); sums[a[i] * 3 + 2] += pos.getZ(a[j]); counts[a[i]]++; } }
      for (let i = 0; i < pos.count; i++) { if (!counts[i]) continue; const ax = sums[i * 3] / counts[i], ay = sums[i * 3 + 1] / counts[i], az = sums[i * 3 + 2] / counts[i]; pos.setXYZ(i, pos.getX(i) * (1 - a0) + ax * a0, pos.getY(i) * (1 - a0) + ay * a0, pos.getZ(i) * (1 - a0) + az * a0); }
      g.computeBoundingBox();
      const size1 = new THREE.Vector3(); g.boundingBox.getSize(size1);
      const c1 = new THREE.Vector3(); g.boundingBox.getCenter(c1);
      const sx = size1.x > 1e-9 ? size0.x / size1.x : 1, sy = size1.y > 1e-9 ? size0.y / size1.y : 1, sz = size1.z > 1e-9 ? size0.z / size1.z : 1;
      for (let i = 0; i < pos.count; i++) pos.setXYZ(i, c0.x + (pos.getX(i) - c1.x) * sx, c0.y + (pos.getY(i) - c1.y) * sy, c0.z + (pos.getZ(i) - c1.z) * sz);
      pos.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
      return g;
    },
  },
  displace: {
    label: 'Displace', inputs: ['geometry'], outputs: ['geometry'],
    params: [{ key: 'strength', type: 'number', default: 0.4 }, { key: 'frequency', type: 'number', default: 1 }],
    eval: (inp, p) => {
      const g = (inp.geometry || makePrimitive('cube', 1)).clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      const pos = g.attributes.position, nrm = g.attributes.normal;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const r = g.boundingSphere ? g.boundingSphere.radius : S;
      const freq = (6.5 * (p.frequency == null ? 1 : p.frequency)) / Math.max(r, 1e-5);
      const amp = (p.strength == null ? 0.4 : p.strength) * r * 0.34;
      for (let i = 0; i < pos.count; i++) {
        const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
        const d = fbm(x * freq, y * freq, z * freq, 4) * amp;
        pos.setXYZ(i, x + nrm.getX(i) * d, y + nrm.getY(i) * d, z + nrm.getZ(i) * d);
      }
      pos.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingSphere();
      return g;
    },
  },
  array: {
    label: 'Array', inputs: ['geometry'], outputs: ['geometry'],
    params: [{ key: 'count', type: 'number', default: 3 }, { key: 'dx', default: 1.5 }, { key: 'dy', default: 0 }, { key: 'dz', default: 0 }],
    eval: (inp, p) => {
      const src = inp.geometry || makePrimitive('cube', 1);
      const n = Math.max(1, Math.min(64, Math.floor(p.count == null ? 3 : p.count)));
      const parts = [];
      for (let i = 0; i < n; i++) { const c = src.clone(); c.translate((p.dx || 0) * S * i, (p.dy || 0) * S * i, (p.dz || 0) * S * i); parts.push(c); }
      const merged = mergeGeometries(parts, false) || src.clone();
      merged.computeVertexNormals(); merged.computeBoundingBox(); merged.computeBoundingSphere();
      return merged;
    },
  },
  merge: {
    label: 'Merge', inputs: ['a', 'b'], outputs: ['geometry'],
    params: [],
    eval: (inp) => {
      const parts = [inp.a, inp.b].filter(Boolean).map((g) => g.clone());
      if (!parts.length) return makePrimitive('cube', 1);
      const merged = parts.length === 1 ? parts[0] : (mergeGeometries(parts, false) || parts[0]);
      merged.computeVertexNormals(); merged.computeBoundingBox(); merged.computeBoundingSphere();
      return merged;
    },
  },
  output: {
    label: 'Output', inputs: ['geometry'], outputs: [],
    params: [],
    eval: (inp) => inp.geometry || null,
  },
};

// A non-destructive modifier STACK (3ds Max / Maya / Blender) is just a linear
// node graph: base -> mod1 -> mod2 -> ... -> output. Re-evaluated from the base
// on every edit, so removing/reordering a mid-stack modifier truly reverts it.
export function evalModifierStack(baseSpec, mods) {
  const nodes = [{ id: 'base', type: (baseSpec && baseSpec.type) || 'primitive', params: (baseSpec && baseSpec.params) || {} }];
  const edges = [];
  let prev = 'base';
  (mods || []).forEach((m, i) => {
    if (m.enabled === false) return;
    const id = `m${i}`;
    nodes.push({ id, type: m.type, params: m.params || {} });
    edges.push({ from: { node: prev, port: 'geometry' }, to: { node: id, port: 'geometry' } });
    prev = id;
  });
  nodes.push({ id: 'out', type: 'output', params: {} });
  edges.push({ from: { node: prev, port: 'geometry' }, to: { node: 'out', port: 'geometry' } });
  return evaluateGraph({ nodes, edges });
}

// Topologically evaluate the graph; returns { geometry, perNode, order, error }.
// `types` selects the node registry (geometry NODE_TYPES by default; pass a
// material/shader registry to evaluate a shading graph). The result field is
// named `geometry` for back-compat but holds whatever the output node emits.
export function evaluateGraph(graph, types = NODE_TYPES) {
  const nodes = new Map((graph.nodes || []).map((n) => [n.id, n]));
  const edges = graph.edges || [];
  // adjacency: for each node, incoming edges (port <- fromNode.out)
  const incoming = new Map();
  for (const n of nodes.keys()) incoming.set(n, []);
  const indeg = new Map([...nodes.keys()].map((k) => [k, 0]));
  for (const e of edges) {
    if (!nodes.has(e.from.node) || !nodes.has(e.to.node)) continue;
    incoming.get(e.to.node).push(e);
    indeg.set(e.to.node, (indeg.get(e.to.node) || 0) + 1);
  }
  // Kahn topo-sort
  const queue = [...nodes.keys()].filter((k) => (indeg.get(k) || 0) === 0);
  const order = [];
  const indeg2 = new Map(indeg);
  while (queue.length) {
    const k = queue.shift(); order.push(k);
    for (const e of edges) {
      if (e.from.node === k) { indeg2.set(e.to.node, indeg2.get(e.to.node) - 1); if (indeg2.get(e.to.node) === 0) queue.push(e.to.node); }
    }
  }
  if (order.length !== nodes.size) return { geometry: null, perNode: {}, order, error: 'cycle or disconnected graph' };

  const perNode = {};
  for (const id of order) {
    const node = nodes.get(id);
    const type = types[node.type];
    if (!type) { perNode[id] = null; continue; }
    const inp = {};
    for (const e of incoming.get(id)) { const src = perNode[e.from.node]; if (src) inp[e.to.port] = src; }
    try { perNode[id] = type.eval(inp, node.params || {}); } catch (err) { perNode[id] = null; }
  }
  // result = the (first) output node's geometry, else the last evaluated geometry
  const outId = [...nodes.values()].find((n) => n.type === 'output');
  let geometry = outId ? perNode[outId.id] : null;
  if (!geometry) { for (let i = order.length - 1; i >= 0; i--) { if (perNode[order[i]]) { geometry = perNode[order[i]]; break; } } }
  return { geometry, perNode, order, error: null };
}
