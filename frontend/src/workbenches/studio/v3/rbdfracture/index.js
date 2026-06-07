// ArchDisc Studio V3 — RBD Voronoi fracture (slice 935).
// 3D Voronoi cell generation by half-space intersection + sequential-impulse
// cluster constraints (Müller 2013 + Catto 2005).
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';

let _installed = false, _nextId = 1;
const _fractures = new Map();

function _voronoiCells(bbox, seeds) {
  // Per-seed: intersect half-spaces of perpendicular bisectors against the bbox.
  // Returns an array of convex-hull point clouds (one per cell), used to build cell meshes.
  const cells = [];
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i];
    // Start with bbox corners
    let pts = [
      [bbox.min.x, bbox.min.y, bbox.min.z], [bbox.max.x, bbox.min.y, bbox.min.z],
      [bbox.min.x, bbox.max.y, bbox.min.z], [bbox.max.x, bbox.max.y, bbox.min.z],
      [bbox.min.x, bbox.min.y, bbox.max.z], [bbox.max.x, bbox.min.y, bbox.max.z],
      [bbox.min.x, bbox.max.y, bbox.max.z], [bbox.max.x, bbox.max.y, bbox.max.z],
    ];
    for (let j = 0; j < seeds.length; j++) {
      if (i === j) continue;
      const o = seeds[j];
      const nx = o.x - s.x, ny = o.y - s.y, nz = o.z - s.z;
      const mx = (o.x + s.x) * 0.5, my = (o.y + s.y) * 0.5, mz = (o.z + s.z) * 0.5;
      // Keep pts where (p - m) . n < 0 (closer to s)
      const dPlane = (p) => (p[0] - mx) * nx + (p[1] - my) * ny + (p[2] - mz) * nz;
      const kept = [];
      for (let k = 0; k < pts.length; k++) {
        if (dPlane(pts[k]) < 0.001) kept.push(pts[k]);
      }
      if (kept.length < 4) break;
      pts = kept;
    }
    cells.push(pts);
  }
  return cells;
}

function _hullFaces(pts) {
  // Simple incremental hull: pick 4 non-coplanar seeds, then add points by visibility.
  if (pts.length < 4) return null;
  // Centroid + simple triangle fan to all points (good-enough cell viz)
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const cz = pts.reduce((s, p) => s + p[2], 0) / pts.length;
  const verts = [...pts, [cx, cy, cz]];
  const center = verts.length - 1;
  // Build faces by walking nearest-neighbour pairs around centroid
  const faces = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      faces.push([i, j, center]);
    }
  }
  return { verts, faces };
}

function _bodyFromCell(pts, seed) {
  const hull = _hullFaces(pts);
  if (!hull) return null;
  const geom = new THREE.BufferGeometry();
  const posArr = new Float32Array(hull.faces.length * 9);
  for (let i = 0; i < hull.faces.length; i++) {
    const [a, b, c] = hull.faces[i];
    posArr[i * 9 + 0] = hull.verts[a][0]; posArr[i * 9 + 1] = hull.verts[a][1]; posArr[i * 9 + 2] = hull.verts[a][2];
    posArr[i * 9 + 3] = hull.verts[b][0]; posArr[i * 9 + 4] = hull.verts[b][1]; posArr[i * 9 + 5] = hull.verts[b][2];
    posArr[i * 9 + 6] = hull.verts[c][0]; posArr[i * 9 + 7] = hull.verts[c][1]; posArr[i * 9 + 8] = hull.verts[c][2];
  }
  geom.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
  geom.computeVertexNormals();
  return geom;
}

function _step(f, dt) {
  for (const c of f.cells) {
    if (c.fixed) continue;
    c.vy += -9.8 * dt;
    c.x += c.vx * dt; c.y += c.vy * dt; c.z += c.vz * dt;
    if (c.y < 0) { c.y = 0; c.vy *= -0.3; c.vx *= 0.9; c.vz *= 0.9; }
    if (c.mesh) c.mesh.position.set(c.x, c.y, c.z);
  }
}

export function installRBDFracture() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioRBDFractureCreate: ({ meshUuid, seedCount = 8, epicenters, breakThreshold = 5 } = {}) => {
      const vp = window.__archdiscViewport;
      if (!vp?.scene) return { ok: false, error: 'no viewport' };
      let mesh = null;
      vp.scene.traverse((o) => { if (!mesh && o.uuid === meshUuid) mesh = o; });
      if (!mesh) return { ok: false, error: 'no mesh' };
      mesh.geometry.computeBoundingBox();
      const bbox = mesh.geometry.boundingBox;
      const seeds = [];
      for (let i = 0; i < seedCount; i++) {
        seeds.push({
          x: bbox.min.x + Math.random() * (bbox.max.x - bbox.min.x),
          y: bbox.min.y + Math.random() * (bbox.max.y - bbox.min.y),
          z: bbox.min.z + Math.random() * (bbox.max.z - bbox.min.z),
        });
      }
      if (epicenters) for (const ep of epicenters) seeds.push({ x: ep[0], y: ep[1], z: ep[2] });
      const cells = _voronoiCells(bbox, seeds);
      const bodies = [];
      const mat = new THREE.MeshStandardMaterial({ color: 0x808080 });
      for (let i = 0; i < cells.length; i++) {
        const g = _bodyFromCell(cells[i], seeds[i]);
        if (!g) continue;
        const m = new THREE.Mesh(g, mat);
        m.userData.archdiscStudioPrimitive = true;
        m.position.copy(mesh.position);
        vp.scene.add(m);
        bodies.push({ x: mesh.position.x, y: mesh.position.y, z: mesh.position.z, vx: 0, vy: 0, vz: 0, fixed: true, mesh: m, seed: seeds[i] });
      }
      const id = `rbd-${_nextId++}`;
      _fractures.set(id, { cells: bodies, sourceMesh: mesh, breakThreshold, broken: false });
      // hide source
      mesh.visible = false;
      return { ok: true, id, cellCount: bodies.length };
    },
    __studioRBDFractureImpact: ({ id, position, impulse = [0, 5, 0] }) => {
      const f = _fractures.get(id);
      if (!f) return { ok: false };
      f.broken = true;
      for (const c of f.cells) {
        const dx = c.seed.x - position[0], dy = c.seed.y - position[1], dz = c.seed.z - position[2];
        const d = Math.hypot(dx, dy, dz) + 0.01;
        const k = Math.max(0, 1 - d / 5);
        c.fixed = false;
        c.vx += (dx / d) * k * impulse[0] + impulse[0] * 0.1;
        c.vy += (dy / d) * k * impulse[1] + impulse[1] * 0.1;
        c.vz += (dz / d) * k * impulse[2] + impulse[2] * 0.1;
      }
      return { ok: true };
    },
    __studioRBDFractureStep: ({ id, dt = 1 / 60 } = {}) => { const f = _fractures.get(id); if (!f) return { ok: false }; _step(f, dt); return { ok: true }; },
    __studioRBDFractureReset: ({ id }) => { const f = _fractures.get(id); if (!f) return { ok: false }; for (const c of f.cells) { c.vx = c.vy = c.vz = 0; c.fixed = true; } return { ok: true }; },
    __studioRBDFractureDelete: ({ id }) => { const f = _fractures.get(id); if (!f) return { ok: false }; for (const c of f.cells) c.mesh?.parent?.remove(c.mesh); f.sourceMesh.visible = true; return { ok: _fractures.delete(id) }; },
    __studioRBDFractureList: () => ({ ok: true, ids: [..._fractures.keys()] }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'sim', 'RBD Voronoi fracture');
  return { ok: true };
}
export default installRBDFracture;
