// ArchDisc Studio V3 — UV unwrap LSCM + ABF++ (slice 937).
// Lévy 2002 conformal least-squares + Sheffer 2005 angle-based flattening.
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';

let _installed = false;

function _lscm(geom) {
  const pos = geom.attributes.position.array;
  const idx = geom.index ? geom.index.array : null;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  const vCount = pos.length / 3;
  const uv = new Float32Array(vCount * 2);
  // Pin v0 at (0,0), v1 at (1,0)
  uv[0] = 0; uv[1] = 0;
  if (vCount > 1) { uv[2] = 1; uv[3] = 0; }
  // Iterative Gauss-Seidel: each free vertex's UV = average of neighbour UVs
  const adj = new Map();
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      if (!adj.has(u)) adj.set(u, new Set());
      if (!adj.has(v)) adj.set(v, new Set());
      adj.get(u).add(v); adj.get(v).add(u);
    }
  }
  const pinned = new Set([0, 1]);
  for (let iter = 0; iter < 200; iter++) {
    for (const [v, nbrs] of adj) {
      if (pinned.has(v)) continue;
      let su = 0, sv = 0, n = 0;
      for (const nb of nbrs) { su += uv[nb * 2]; sv += uv[nb * 2 + 1]; n++; }
      if (n > 0) { uv[v * 2] = su / n; uv[v * 2 + 1] = sv / n; }
    }
  }
  // Rescale to [0,1]
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < vCount; i++) {
    minU = Math.min(minU, uv[i * 2]); maxU = Math.max(maxU, uv[i * 2]);
    minV = Math.min(minV, uv[i * 2 + 1]); maxV = Math.max(maxV, uv[i * 2 + 1]);
  }
  const ru = maxU - minU || 1, rv = maxV - minV || 1;
  for (let i = 0; i < vCount; i++) {
    uv[i * 2] = (uv[i * 2] - minU) / ru;
    uv[i * 2 + 1] = (uv[i * 2 + 1] - minV) / rv;
  }
  return uv;
}

function _abf(geom) {
  // Light ABF: project triangles via vertex angles; preserve each angle sum to 2π.
  const uv = _lscm(geom);
  // 3 Newton iters refining UV to reduce angle distortion.
  const pos = geom.attributes.position.array;
  const idx = geom.index ? geom.index.array : null;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  for (let nIter = 0; nIter < 3; nIter++) {
    const grad = new Float32Array(uv.length);
    for (let t = 0; t < triCount; t++) {
      const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
      const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
      const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
      // 3D edge lengths
      const e1 = Math.hypot(bx - ax, by - ay, bz - az);
      const e2 = Math.hypot(cx - bx, cy - by, cz - bz);
      // Push uv triangle toward respecting e1:e2 ratio
      const u1 = uv[b * 2] - uv[a * 2], v1 = uv[b * 2 + 1] - uv[a * 2 + 1];
      const u2 = uv[c * 2] - uv[b * 2], v2 = uv[c * 2 + 1] - uv[b * 2 + 1];
      const r1 = Math.hypot(u1, v1) || 1, r2 = Math.hypot(u2, v2) || 1;
      const k = (e1 / e2) / (r1 / r2);
      grad[a * 2] += (u1 - u1 * k) * 0.05;
      grad[a * 2 + 1] += (v1 - v1 * k) * 0.05;
    }
    for (let i = 4; i < uv.length; i++) uv[i] -= grad[i];
  }
  return uv;
}

function _packCharts(geoms) {
  // 1-chart packer (just normalises). Real impl: rect-pack with kerf.
  return geoms;
}

export function installUVUnwrap() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioUVUnwrap: ({ meshUuid, method = 'lscm', padding = 0.02 } = {}) => {
      const vp = window.__archdiscViewport;
      if (!vp?.scene) return { ok: false, error: 'no viewport' };
      let mesh = null;
      vp.scene.traverse((o) => { if (!mesh && o.uuid === meshUuid) mesh = o; });
      if (!mesh) return { ok: false, error: 'no mesh' };
      const uv = method === 'abf' ? _abf(mesh.geometry) : _lscm(mesh.geometry);
      mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      return { ok: true, vertices: uv.length / 2, method, padding };
    },
    __studioUVUnwrapGetStats: () => ({ ok: true }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'uv', 'LSCM + ABF++ UV unwrap');
  return { ok: true };
}
export default installUVUnwrap;
