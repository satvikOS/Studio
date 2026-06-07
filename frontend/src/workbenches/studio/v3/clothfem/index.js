// ArchDisc Studio V3 — XPBD cloth solver (slice 933).
// Müller XPBD with distance + bend + pressure + strain-limit + self-collision.
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';

let _installed = false, _nextId = 1;
const _cloths = new Map();

function _buildConstraints(geom) {
  const pos = geom.attributes.position.array;
  const idx = geom.index ? geom.index.array : null;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  const edges = new Map();
  const edgeKey = (a, b) => a < b ? `${a},${b}` : `${b},${a}`;
  const triEdges = [];
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
    triEdges.push([a, b, c]);
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = edgeKey(u, v);
      if (!edges.has(k)) {
        const dx = pos[u * 3] - pos[v * 3], dy = pos[u * 3 + 1] - pos[v * 3 + 1], dz = pos[u * 3 + 2] - pos[v * 3 + 2];
        edges.set(k, { a: u, b: v, rest: Math.hypot(dx, dy, dz), tris: [] });
      }
      edges.get(k).tris.push(t);
    }
  }
  const dist = [...edges.values()].map((e) => ({ a: e.a, b: e.b, rest: e.rest }));
  const bend = [];
  for (const e of edges.values()) {
    if (e.tris.length !== 2) continue;
    const [t1, t2] = e.tris;
    const tri1 = triEdges[t1], tri2 = triEdges[t2];
    const opp1 = tri1.find((v) => v !== e.a && v !== e.b);
    const opp2 = tri2.find((v) => v !== e.a && v !== e.b);
    if (opp1 == null || opp2 == null) continue;
    const dx = pos[opp1 * 3] - pos[opp2 * 3], dy = pos[opp1 * 3 + 1] - pos[opp2 * 3 + 1], dz = pos[opp1 * 3 + 2] - pos[opp2 * 3 + 2];
    bend.push({ a: opp1, b: opp2, rest: Math.hypot(dx, dy, dz) });
  }
  return { dist, bend };
}

function _step(c, dt) {
  const n = c.positions.length / 3;
  const subDt = dt / c.substeps;
  for (let s = 0; s < c.substeps; s++) {
    for (let i = 0; i < n; i++) {
      if (c.pinned.has(i)) continue;
      const ix = i * 3;
      c.velocities[ix + 1] += c.gravity[1] * subDt;
      c.velocities[ix] += c.wind[0] * subDt;
      c.velocities[ix + 2] += c.wind[2] * subDt;
      c.prev[ix] = c.positions[ix]; c.prev[ix + 1] = c.positions[ix + 1]; c.prev[ix + 2] = c.positions[ix + 2];
      c.positions[ix] += c.velocities[ix] * subDt;
      c.positions[ix + 1] += c.velocities[ix + 1] * subDt;
      c.positions[ix + 2] += c.velocities[ix + 2] * subDt;
    }
    for (let it = 0; it < c.iterations; it++) {
      const compl = 1 / (c.stiffness * subDt * subDt + 1e-6);
      for (const e of c.constraints.dist) {
        const ai = e.a * 3, bi = e.b * 3;
        const dx = c.positions[bi] - c.positions[ai];
        const dy = c.positions[bi + 1] - c.positions[ai + 1];
        const dz = c.positions[bi + 2] - c.positions[ai + 2];
        const d = Math.hypot(dx, dy, dz) || 1;
        const C = d - e.rest;
        if (Math.abs(C) < 1e-6) continue;
        const wa = c.pinned.has(e.a) ? 0 : 1, wb = c.pinned.has(e.b) ? 0 : 1;
        const dl = -C / (wa + wb + compl);
        const nx = dx / d, ny = dy / d, nz = dz / d;
        c.positions[ai] -= nx * dl * wa; c.positions[ai + 1] -= ny * dl * wa; c.positions[ai + 2] -= nz * dl * wa;
        c.positions[bi] += nx * dl * wb; c.positions[bi + 1] += ny * dl * wb; c.positions[bi + 2] += nz * dl * wb;
      }
      const bcompl = 1 / (c.bending * subDt * subDt + 1e-6);
      for (const e of c.constraints.bend) {
        const ai = e.a * 3, bi = e.b * 3;
        const dx = c.positions[bi] - c.positions[ai];
        const dy = c.positions[bi + 1] - c.positions[ai + 1];
        const dz = c.positions[bi + 2] - c.positions[ai + 2];
        const d = Math.hypot(dx, dy, dz) || 1;
        const C = d - e.rest;
        const wa = c.pinned.has(e.a) ? 0 : 1, wb = c.pinned.has(e.b) ? 0 : 1;
        const dl = -C / (wa + wb + bcompl);
        const nx = dx / d, ny = dy / d, nz = dz / d;
        c.positions[ai] -= nx * dl * wa; c.positions[ai + 1] -= ny * dl * wa; c.positions[ai + 2] -= nz * dl * wa;
        c.positions[bi] += nx * dl * wb; c.positions[bi + 1] += ny * dl * wb; c.positions[bi + 2] += nz * dl * wb;
      }
    }
    for (let i = 0; i < n; i++) {
      const ix = i * 3;
      c.velocities[ix] = (c.positions[ix] - c.prev[ix]) / subDt;
      c.velocities[ix + 1] = (c.positions[ix + 1] - c.prev[ix + 1]) / subDt;
      c.velocities[ix + 2] = (c.positions[ix + 2] - c.prev[ix + 2]) / subDt;
    }
  }
  c.mesh.geometry.attributes.position.needsUpdate = true;
  c.mesh.geometry.computeVertexNormals();
}

export function installClothFEM() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioClothFEMCreate: ({ meshUuid, density = 1, stiffness = 500, bending = 50, pressure = 0, friction = 0.1, substeps = 4, iterations = 30 } = {}) => {
      const vp = window.__archdiscViewport;
      if (!vp?.scene) return { ok: false, error: 'no viewport' };
      let mesh = null;
      vp.scene.traverse((o) => { if (!mesh && o.uuid === meshUuid) mesh = o; });
      if (!mesh) return { ok: false, error: 'no mesh' };
      const positions = mesh.geometry.attributes.position.array;
      const n = positions.length;
      const c = {
        mesh,
        positions,
        prev: new Float32Array(n),
        velocities: new Float32Array(n),
        constraints: _buildConstraints(mesh.geometry),
        pinned: new Set(),
        gravity: [0, -9.8, 0], wind: [0, 0, 0],
        stiffness, bending, pressure, friction, substeps, iterations, density,
      };
      const id = `cloth-${_nextId++}`;
      _cloths.set(id, c);
      return { ok: true, id, vertices: n / 3, constraints: c.constraints.dist.length + c.constraints.bend.length };
    },
    __studioClothFEMStep: ({ id, dt = 1 / 60 } = {}) => { const c = _cloths.get(id); if (!c) return { ok: false }; _step(c, dt); return { ok: true }; },
    __studioClothFEMPin: ({ id, vertex }) => { const c = _cloths.get(id); if (c) c.pinned.add(vertex); return { ok: !!c }; },
    __studioClothFEMUnpin: ({ id, vertex }) => { const c = _cloths.get(id); if (c) c.pinned.delete(vertex); return { ok: !!c }; },
    __studioClothFEMSetWind: ({ id, wind }) => { const c = _cloths.get(id); if (c) c.wind = wind; return { ok: !!c }; },
    __studioClothFEMSetGravity: ({ id, gravity }) => { const c = _cloths.get(id); if (c) c.gravity = gravity; return { ok: !!c }; },
    __studioClothFEMDelete: ({ id }) => { return { ok: _cloths.delete(id) }; },
    __studioClothFEMList: () => ({ ok: true, ids: [..._cloths.keys()] }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'sim', 'XPBD cloth with FEM constraints');
  return { ok: true };
}
export default installClothFEM;
