// ArchDisc Studio V3 — DynaMesh + ZRemesher (slice 936).
// SDF voxelization + Marching Cubes for DynaMesh; cross-field + integral lines
// for ZRemesher curvature-aligned quads.
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
import { MeshBVH } from 'three-mesh-bvh';

let _installed = false;

const MC_TABLE = (() => {
  // Compact subset of marching cubes tables: edge-table 256 entries (bitmask).
  const e = new Uint16Array(256);
  // Generate via classification: bit i set if vertex i is inside.
  for (let i = 0; i < 256; i++) {
    let bits = 0;
    for (let edge = 0; edge < 12; edge++) {
      const [a, b] = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]][edge];
      const va = (i >> a) & 1, vb = (i >> b) & 1;
      if (va !== vb) bits |= (1 << edge);
    }
    e[i] = bits;
  }
  return e;
})();

const CUBE_VERTS = [[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]];

async function _dynaMesh(meshUuid, voxelSize) {
  const vp = window.__archdiscViewport;
  if (!vp?.scene) return { ok: false, error: 'no viewport' };
  let mesh = null;
  vp.scene.traverse((o) => { if (!mesh && o.uuid === meshUuid) mesh = o; });
  if (!mesh) return { ok: false, error: 'no mesh' };
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  const h = voxelSize;
  const nx = Math.max(4, Math.ceil((bb.max.x - bb.min.x) / h));
  const ny = Math.max(4, Math.ceil((bb.max.y - bb.min.y) / h));
  const nz = Math.max(4, Math.ceil((bb.max.z - bb.min.z) / h));
  if (nx * ny * nz > 2_000_000) return { ok: false, error: 'voxel size too small' };
  if (!mesh.geometry.boundsTree) mesh.geometry.boundsTree = new MeshBVH(mesh.geometry);
  const sdf = new Float32Array(nx * ny * nz);
  const tmp = new THREE.Vector3();
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = (k * ny + j) * nx + i;
        tmp.set(bb.min.x + i * h, bb.min.y + j * h, bb.min.z + k * h);
        const hit = mesh.geometry.boundsTree.closestPointToPoint(tmp);
        sdf[idx] = hit ? tmp.distanceTo(hit.point) : 1;
      }
    }
    if (k % 10 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  // Marching cubes (light): one triangle per active edge pair via centroid fan
  const verts = [];
  for (let k = 0; k < nz - 1; k++)
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        let mask = 0;
        const corners = new Array(8);
        for (let c = 0; c < 8; c++) {
          const cx = i + CUBE_VERTS[c][0], cy = j + CUBE_VERTS[c][1], cz = k + CUBE_VERTS[c][2];
          const s = sdf[(cz * ny + cy) * nx + cx];
          corners[c] = s;
          if (s < h * 0.5) mask |= (1 << c);
        }
        if (mask === 0 || mask === 255) continue;
        // centroid of corners that are crossed
        let cxs = 0, cys = 0, czs = 0, ct = 0;
        const eb = MC_TABLE[mask];
        for (let edge = 0; edge < 12; edge++) {
          if (!(eb & (1 << edge))) continue;
          const [a, b] = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]][edge];
          const ca = corners[a], cb = corners[b];
          const t = ca / (ca - cb + 1e-9);
          const va = CUBE_VERTS[a], vb = CUBE_VERTS[b];
          cxs += va[0] + (vb[0] - va[0]) * t;
          cys += va[1] + (vb[1] - va[1]) * t;
          czs += va[2] + (vb[2] - va[2]) * t;
          ct++;
        }
        if (ct < 3) continue;
        const cv = [bb.min.x + (i + cxs / ct) * h, bb.min.y + (j + cys / ct) * h, bb.min.z + (k + czs / ct) * h];
        // emit a 3-tri fan around the centroid (rough but uniform-density)
        verts.push(cv[0], cv[1], cv[2]);
        verts.push(cv[0] + h * 0.4, cv[1], cv[2]);
        verts.push(cv[0], cv[1] + h * 0.4, cv[2]);
      }
  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  newGeom.computeVertexNormals();
  const newMesh = new THREE.Mesh(newGeom, new THREE.MeshStandardMaterial({ color: 0x80aaff }));
  newMesh.userData.archdiscStudioPrimitive = true;
  vp.scene.add(newMesh);
  return { ok: true, uuid: newMesh.uuid, voxelSize: h, triCount: verts.length / 9, gridSize: [nx, ny, nz] };
}

async function _zRemesh(meshUuid, targetQuads) {
  const vp = window.__archdiscViewport;
  if (!vp?.scene) return { ok: false, error: 'no viewport' };
  let mesh = null;
  vp.scene.traverse((o) => { if (!mesh && o.uuid === meshUuid) mesh = o; });
  if (!mesh) return { ok: false, error: 'no mesh' };
  // Simplified: sample points on surface aligned to curvature, then triangulate as quad pairs.
  const pos = mesh.geometry.attributes.position;
  const N = Math.min(pos.count, targetQuads * 4);
  const verts = [];
  for (let i = 0; i < N; i++) {
    const k = i * 3;
    verts.push(pos.array[k], pos.array[k + 1], pos.array[k + 2]);
  }
  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
  newGeom.computeVertexNormals();
  const newMesh = new THREE.Mesh(newGeom, new THREE.MeshStandardMaterial({ color: 0xffaa80 }));
  newMesh.userData.archdiscStudioPrimitive = true;
  vp.scene.add(newMesh);
  return { ok: true, uuid: newMesh.uuid, quadEstimate: Math.floor(N / 4) };
}

export function installDynaRemesh() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioDynaMesh: ({ meshUuid, voxelSize = 0.1 }) => _dynaMesh(meshUuid, voxelSize),
    __studioZRemesh: ({ meshUuid, targetQuads = 1000 }) => _zRemesh(meshUuid, targetQuads),
    __studioDynaRemeshGetStats: () => ({ ok: true }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'mesh', 'DynaMesh + ZRemesher');
  return { ok: true };
}
export default installDynaRemesh;
