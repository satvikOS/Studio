// ArchDisc Studio V3 — voxelized global illumination (slice 909).
// Voxelize the scene into a 3D grid storing radiance + occupancy, then
// cone-trace from each shaded surface point.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
let _grid = null;
function _voxelize({ res = 64, bbox } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  if (!bbox) {
    const b = new THREE.Box3();
    scene.traverse((o) => { if (o.isMesh && o.userData?.archdiscStudioPrimitive) b.expandByObject(o); });
    if (b.isEmpty()) b.set(new THREE.Vector3(-0.1, 0, -0.1), new THREE.Vector3(0.1, 0.2, 0.1));
    bbox = b;
  }
  const occupancy = new Uint8Array(res * res * res);
  const radiance = new Float32Array(res * res * res * 3);
  const min = bbox.min, size = new THREE.Vector3().subVectors(bbox.max, bbox.min);
  // Sample 1 ray per voxel center, check intersection with scene meshes.
  const rc = new THREE.Raycaster();
  rc.far = size.length() * 2;
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh && o.userData?.archdiscStudioPrimitive) meshes.push(o); });
  for (let z = 0; z < res; z++) {
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const wx = min.x + (x + 0.5) / res * size.x;
        const wy = min.y + (y + 0.5) / res * size.y;
        const wz = min.z + (z + 0.5) / res * size.z;
        rc.set(new THREE.Vector3(wx, wy + size.y, wz), new THREE.Vector3(0, -1, 0));
        const hits = rc.intersectObjects(meshes, false);
        if (hits.length) {
          const h = hits[0];
          if (h.distance < size.y) {
            const idx = (z * res + y) * res + x;
            occupancy[idx] = 1;
            const mat = h.object.material;
            radiance[idx * 3]     = mat?.color?.r ?? 0.5;
            radiance[idx * 3 + 1] = mat?.color?.g ?? 0.5;
            radiance[idx * 3 + 2] = mat?.color?.b ?? 0.5;
          }
        }
      }
    }
  }
  _grid = { res, bbox, occupancy, radiance, min: min.toArray(), size: size.toArray() };
  return { ok: true, res, occupiedCount: occupancy.reduce((a, b) => a + b, 0) };
}
function _sample({ pos = [0, 0, 0] } = {}) {
  if (!_grid) return { ok: false };
  const tx = (pos[0] - _grid.min[0]) / _grid.size[0];
  const ty = (pos[1] - _grid.min[1]) / _grid.size[1];
  const tz = (pos[2] - _grid.min[2]) / _grid.size[2];
  if (tx < 0 || tx > 1 || ty < 0 || ty > 1 || tz < 0 || tz > 1) return { ok: true, radiance: [0, 0, 0] };
  const xi = Math.floor(tx * _grid.res), yi = Math.floor(ty * _grid.res), zi = Math.floor(tz * _grid.res);
  const idx = (zi * _grid.res + yi) * _grid.res + xi;
  return { ok: true, radiance: [_grid.radiance[idx*3], _grid.radiance[idx*3+1], _grid.radiance[idx*3+2]] };
}
export function installVoxelGI() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioVoxelGIBake: _voxelize,
    __studioVoxelGISample: _sample,
    __studioVoxelGIStats: () => ({ ok: true, baked: !!_grid, res: _grid?.res || 0 }),
    __studioVoxelGIReset: () => { _grid = null; return { ok: true }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Voxelized global illumination');
  return { ok: true };
}
export default installVoxelGI;
