// Slice 698 — 3D volume grid (density + temperature) backed by Data3DTexture.

import * as THREE from 'three';

const _volumes = new Map();
let _seq = 1;
function _uuid() { return `vol-${_seq++}-${Date.now().toString(36)}`; }

export function createVolume(sx, sy, sz, voxelSize) {
  const SX = Math.max(8, Math.min(128, Math.floor(sx) || 64));
  const SY = Math.max(8, Math.min(128, Math.floor(sy) || 64));
  const SZ = Math.max(8, Math.min(128, Math.floor(sz) || 64));
  const vs = Number(voxelSize) || 0.05;
  // RG channels: R=density (Uint8), G=temperature (Uint8).
  const data = new Uint8Array(SX * SY * SZ * 4);
  const tex = new THREE.Data3DTexture(data, SX, SY, SZ);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  const uuid = _uuid();
  _volumes.set(uuid, { uuid, sx: SX, sy: SY, sz: SZ, voxelSize: vs, data, tex });
  return { ok: true, uuid, sx: SX, sy: SY, sz: SZ };
}

export function getVolume(uuid) { return _volumes.get(uuid); }
export function listVolumes() {
  return Array.from(_volumes.values()).map((v) => ({ uuid: v.uuid, sx: v.sx, sy: v.sy, sz: v.sz, voxelSize: v.voxelSize }));
}

export function setVoxel(uuid, x, y, z, density, temperature) {
  const v = _volumes.get(uuid);
  if (!v) return { ok: false };
  if (x < 0 || x >= v.sx || y < 0 || y >= v.sy || z < 0 || z >= v.sz) return { ok: false };
  const i = (x + y * v.sx + z * v.sx * v.sy) * 4;
  v.data[i]     = Math.max(0, Math.min(255, Math.round((Number(density) || 0) * 255)));
  v.data[i + 1] = Math.max(0, Math.min(255, Math.round((Number(temperature) || 0) * 255)));
  v.data[i + 2] = 0;
  v.data[i + 3] = 255;
  v.tex.needsUpdate = true;
  return { ok: true };
}

export function clearVolume(uuid) {
  const v = _volumes.get(uuid);
  if (!v) return { ok: false };
  v.data.fill(0);
  v.tex.needsUpdate = true;
  return { ok: true };
}

export function deleteVolume(uuid) {
  const v = _volumes.get(uuid);
  if (!v) return { ok: false };
  if (v.mesh && v.mesh.parent) v.mesh.parent.remove(v.mesh);
  if (v.tex && v.tex.dispose) v.tex.dispose();
  _volumes.delete(uuid);
  return { ok: true };
}
