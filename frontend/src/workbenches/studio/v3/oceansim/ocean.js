// Slice 714 — Houdini-style ocean simulator. Generates a tessellated
// grid mesh whose vertex Y is animated by a sum of sine waves at
// different amplitudes / frequencies / directions (Gerstner-like
// approximation). Supports wind speed, choppy factor, and runtime
// animation via the slice-695 anim tick.

import * as THREE from 'three';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';

const _oceans = new Map();
let _seq = 1;
function _uid() { return `oc-${_seq++}-${Date.now().toString(36)}`; }

const DEFAULT_WAVES = [
  { amp: 0.5, freq: 0.4, dir: [1, 0],     phase: 0,    speed: 0.6 },
  { amp: 0.3, freq: 0.7, dir: [0.7, 0.7], phase: 1.5,  speed: 0.8 },
  { amp: 0.2, freq: 1.2, dir: [-0.5, 0.8], phase: 2.7,  speed: 1.1 },
  { amp: 0.1, freq: 2.0, dir: [0.3, -0.9], phase: 0.6,  speed: 1.5 },
];

export function createOcean(opts) {
  const id = _uid();
  const size = Number(opts?.size) || 30;
  const segs = Math.max(16, Math.min(256, Number(opts?.segments) || 96));
  const choppy = Number(opts?.choppy) || 0.4;
  const windSpeed = Number(opts?.windSpeed) || 1;
  const waves = opts?.waves || DEFAULT_WAVES;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const positions = geo.attributes.position;
  const basePos = new Float32Array(positions.array);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1a5a8a,
    roughness: 0.1,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'ocean';
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'ocean';
  if (window.__archdiscScene) window.__archdiscScene.add(mesh);
  const ocean = {
    id, mesh, basePos, waves, choppy, windSpeed, t0: performance.now() * 0.001,
  };
  _oceans.set(id, ocean);
  chainIntoAnimTick(`ocean_${id}`, () => _tick(ocean));
  return { ok: true, id, meshUuid: mesh.uuid };
}

function _tick(o) {
  const t = performance.now() * 0.001 - o.t0;
  const pos = o.mesh.geometry.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const bx = o.basePos[i * 3];
    const bz = o.basePos[i * 3 + 2];
    let dx = 0, dy = 0, dz = 0;
    for (const w of o.waves) {
      const dirX = w.dir[0], dirZ = w.dir[1];
      const phase = (bx * dirX + bz * dirZ) * w.freq + t * w.speed * o.windSpeed + w.phase;
      const wave = Math.sin(phase) * w.amp;
      dy += wave;
      dx += Math.cos(phase) * w.amp * o.choppy * dirX;
      dz += Math.cos(phase) * w.amp * o.choppy * dirZ;
    }
    pos.array[i * 3]     = bx + dx;
    pos.array[i * 3 + 1] = dy;
    pos.array[i * 3 + 2] = bz + dz;
  }
  pos.needsUpdate = true;
  o.mesh.geometry.computeVertexNormals();
}

export function setWindSpeed(id, speed) {
  const o = _oceans.get(id);
  if (!o) return { ok: false };
  o.windSpeed = Number(speed);
  return { ok: true };
}

export function setChoppy(id, c) {
  const o = _oceans.get(id);
  if (!o) return { ok: false };
  o.choppy = Math.max(0, Math.min(2, Number(c)));
  return { ok: true };
}

export function addWave(id, wave) {
  const o = _oceans.get(id);
  if (!o) return { ok: false };
  o.waves.push(wave);
  return { ok: true };
}

export function listOceans() {
  return {
    ok: true,
    oceans: Array.from(_oceans.values()).map((o) => ({
      id: o.id, meshUuid: o.mesh.uuid,
      waves: o.waves.length, choppy: o.choppy, windSpeed: o.windSpeed,
    })),
  };
}

export function deleteOcean(id) {
  const o = _oceans.get(id);
  if (!o) return { ok: false };
  unchainFromAnimTick(`ocean_${id}`);
  if (o.mesh.parent) o.mesh.parent.remove(o.mesh);
  _oceans.delete(id);
  return { ok: true };
}
