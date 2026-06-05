// Slice 698 — Pre-fab volume generators: cloud / fire / fog / plasma.

import { setVoxel, getVolume } from './grid.js';
import { valueNoise3D } from '../common/noise.js';

export function cloudPuff(uuid) {
  const v = getVolume(uuid);
  if (!v) return { ok: false };
  const cx = v.sx / 2, cy = v.sy / 2, cz = v.sz / 2;
  const r = Math.min(cx, cy, cz) * 0.7;
  for (let z = 0; z < v.sz; z++) for (let y = 0; y < v.sy; y++) for (let x = 0; x < v.sx; x++) {
    const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2);
    const noise = (valueNoise3D(x * 0.15, y * 0.15, z * 0.15) + 1) * 0.5;
    const dens = Math.max(0, 1 - d / r) * (0.5 + noise * 0.5);
    setVoxel(uuid, x, y, z, dens * 0.6, 0);
  }
  return { ok: true };
}

export function firePlume(uuid) {
  const v = getVolume(uuid);
  if (!v) return { ok: false };
  const cx = v.sx / 2, cz = v.sz / 2;
  for (let z = 0; z < v.sz; z++) for (let y = 0; y < v.sy; y++) for (let x = 0; x < v.sx; x++) {
    const dxz = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2);
    const heightFrac = y / v.sy;
    const radiusAt = (1 - heightFrac) * v.sx * 0.35 + 1;
    const noise = (valueNoise3D(x * 0.2, y * 0.2 - heightFrac * 5, z * 0.2) + 1) * 0.5;
    let dens = Math.max(0, 1 - dxz / radiusAt) * (1 - heightFrac * 0.7);
    dens *= 0.5 + noise * 0.5;
    const temp = Math.max(0, 1 - heightFrac) * Math.max(0, 1 - dxz / (radiusAt * 0.6));
    setVoxel(uuid, x, y, z, dens, temp);
  }
  return { ok: true };
}

export function groundFog(uuid) {
  const v = getVolume(uuid);
  if (!v) return { ok: false };
  for (let z = 0; z < v.sz; z++) for (let y = 0; y < v.sy; y++) for (let x = 0; x < v.sx; x++) {
    const heightFrac = y / v.sy;
    const noise = (valueNoise3D(x * 0.1, y * 0.3, z * 0.1) + 1) * 0.5;
    const dens = Math.max(0, 1 - heightFrac * 2.5) * (0.6 + noise * 0.4) * 0.4;
    setVoxel(uuid, x, y, z, dens, 0);
  }
  return { ok: true };
}

export function plasma(uuid) {
  const v = getVolume(uuid);
  if (!v) return { ok: false };
  for (let z = 0; z < v.sz; z++) for (let y = 0; y < v.sy; y++) for (let x = 0; x < v.sx; x++) {
    const a = Math.sin(x * 0.3) + Math.cos(y * 0.3) + Math.sin(z * 0.3);
    const dens = (a + 3) / 6 * 0.6;
    const temp = (valueNoise3D(x * 0.1, y * 0.1, z * 0.1) + 1) * 0.5;
    setVoxel(uuid, x, y, z, dens, temp);
  }
  return { ok: true };
}
