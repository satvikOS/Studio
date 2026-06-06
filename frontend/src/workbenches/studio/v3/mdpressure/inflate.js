// Slice 717 — Marvelous Designer pressure inflation. Apply a per-
// vertex outward force along the surface normal until the garment
// "stuffs" to a target volume. Mirrors MD's pressure / stuffing
// parameter that turns a flat pattern into a puffy pillow.

import * as THREE from 'three';

const _inflations = new Map();

export function attachPressure(meshUuid, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry) return { ok: false };
  const baseVolume = _meshVolume(mesh);
  const target = baseVolume * (1 + (Number(opts?.pressure) || 0.5));
  _inflations.set(meshUuid, {
    pressure: Number(opts?.pressure) || 0.5,
    targetVolume: target,
    stepSize: Number(opts?.stepSize) || 0.01,
    iters: 0,
  });
  return { ok: true, baseVolume, targetVolume: target };
}

function _meshVolume(mesh) {
  if (!mesh.geometry?.attributes?.position) return 0;
  const pos = mesh.geometry.attributes.position.array;
  const idx = mesh.geometry.index?.array;
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  let vol = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3] : t * 3;
    const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const ax = pos[i0 * 3], ay = pos[i0 * 3 + 1], az = pos[i0 * 3 + 2];
    const bx = pos[i1 * 3], by = pos[i1 * 3 + 1], bz = pos[i1 * 3 + 2];
    const cx = pos[i2 * 3], cy = pos[i2 * 3 + 1], cz = pos[i2 * 3 + 2];
    vol += (ax * (by * cz - bz * cy) + bx * (cy * az - cz * ay) + cx * (ay * bz - az * by)) / 6;
  }
  return Math.abs(vol);
}

export function step(meshUuid, iters) {
  const scene = window.__archdiscScene;
  const mesh = scene?.getObjectByProperty('uuid', meshUuid);
  const inflation = _inflations.get(meshUuid);
  if (!mesh || !inflation) return { ok: false };
  const N = Math.max(1, Math.min(100, Number(iters) || 5));
  for (let it = 0; it < N; it++) {
    const curVol = _meshVolume(mesh);
    if (curVol >= inflation.targetVolume) break;
    const nrm = mesh.geometry.attributes.normal.array;
    const pos = mesh.geometry.attributes.position.array;
    const step = inflation.stepSize;
    for (let i = 0; i < pos.length / 3; i++) {
      pos[i * 3] += nrm[i * 3] * step;
      pos[i * 3 + 1] += nrm[i * 3 + 1] * step;
      pos[i * 3 + 2] += nrm[i * 3 + 2] * step;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
    inflation.iters++;
  }
  return { ok: true, iters: inflation.iters, currentVolume: _meshVolume(mesh) };
}

export function setPressure(meshUuid, pressure) {
  const inflation = _inflations.get(meshUuid);
  if (!inflation) return { ok: false };
  const baseVolume = inflation.targetVolume / (1 + inflation.pressure);
  inflation.pressure = Number(pressure);
  inflation.targetVolume = baseVolume * (1 + inflation.pressure);
  return { ok: true };
}

export function detach(meshUuid) {
  return { ok: _inflations.delete(meshUuid) };
}

export function listInflations() {
  return {
    ok: true,
    inflations: Array.from(_inflations.entries()).map(([uuid, i]) => ({
      meshUuid: uuid, pressure: i.pressure, targetVolume: i.targetVolume, iters: i.iters,
    })),
  };
}
