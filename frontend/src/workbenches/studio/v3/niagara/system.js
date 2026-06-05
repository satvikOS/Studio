// Slice 703 — Niagara-style real-time particle system. Per-particle
// state in Float32 attribute buffers driven by emitter modules
// (spawn / velocity / forces / curl / size / color / kill). Renders
// with THREE.Points + custom additive shader so 50k particles run at
// 60 fps. Mirrors Unreal Niagara's emitter-module pipeline.

import * as THREE from 'three';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';
import { valueNoise3D } from '../common/noise.js';
const perlin3 = (x, y, z) => valueNoise3D(x, y, z, 0) * 2 - 1;

const _systems = new Map();
let _seq = 1;
function _uid() { return `nia-${_seq++}-${Date.now().toString(36)}`; }

function _vert() {
  return `
    attribute float aSize;
    attribute vec3 aColor;
    varying vec3 vColor;
    void main() {
      vColor = aColor;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * (300.0 / -mv.z);
      gl_Position = projectionMatrix * mv;
    }
  `;
}
function _frag() {
  return `
    precision mediump float;
    varying vec3 vColor;
    void main() {
      vec2 c = gl_PointCoord - vec2(0.5);
      float d = dot(c, c);
      if (d > 0.25) discard;
      float a = smoothstep(0.25, 0.0, d);
      gl_FragColor = vec4(vColor, a);
    }
  `;
}

export function createSystem(opts) {
  const maxParticles = Math.max(64, Math.min(50000, Number(opts?.maxParticles) || 4096));
  const pos = new Float32Array(maxParticles * 3);
  const vel = new Float32Array(maxParticles * 3);
  const age = new Float32Array(maxParticles);
  const life = new Float32Array(maxParticles);
  const size = new Float32Array(maxParticles);
  const color = new Float32Array(maxParticles * 3);
  const alive = new Uint8Array(maxParticles);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
  geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    vertexShader: _vert(),
    fragmentShader: _frag(),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.name = 'niagara';
  if (window.__archdiscScene) window.__archdiscScene.add(points);
  const id = _uid();
  const sys = {
    id, maxParticles, points, geo,
    arrays: { pos, vel, age, life, size, color, alive },
    aliveCount: 0, nextFreeHint: 0,
    spawnRate: Number(opts?.spawnRate) || 80,
    spawnAcc: 0,
    emitter: {
      origin: opts?.origin || [0, 0, 0],
      box: opts?.box || [0.5, 0.5, 0.5],
      velocity: opts?.velocity || [0, 1, 0],
      velocityJitter: Number(opts?.velocityJitter) || 0.4,
      sizeMin: Number(opts?.sizeMin) || 4,
      sizeMax: Number(opts?.sizeMax) || 14,
      colorStart: opts?.colorStart || [1, 0.7, 0.2],
      colorEnd: opts?.colorEnd || [0.4, 0.1, 0.0],
      lifetime: Number(opts?.lifetime) || 2.5,
    },
    modules: {
      gravity: opts?.gravity || [0, -1.2, 0],
      drag: Number(opts?.drag) || 0.02,
      curlAmp: Number(opts?.curlAmp) || 0.0,
      curlFreq: Number(opts?.curlFreq) || 0.4,
    },
    enabled: true,
  };
  _systems.set(id, sys);
  // Chain into tick.
  chainIntoAnimTick(`niagara_${id}`, (dt) => _tick(sys, dt));
  return { ok: true, id, points: points.uuid };
}

function _tick(sys, dt) {
  if (!sys.enabled) return;
  const dtClamp = Math.min(0.05, Math.max(0.001, dt || 0.016));
  const { pos, vel, age, life, size, color, alive } = sys.arrays;
  const e = sys.emitter;
  // Spawn.
  sys.spawnAcc += dtClamp * sys.spawnRate;
  while (sys.spawnAcc >= 1) {
    sys.spawnAcc -= 1;
    let idx = -1;
    for (let k = 0; k < sys.maxParticles; k++) {
      const i = (sys.nextFreeHint + k) % sys.maxParticles;
      if (!alive[i]) { idx = i; sys.nextFreeHint = (i + 1) % sys.maxParticles; break; }
    }
    if (idx < 0) break;
    pos[idx * 3 + 0] = e.origin[0] + (Math.random() - 0.5) * e.box[0];
    pos[idx * 3 + 1] = e.origin[1] + (Math.random() - 0.5) * e.box[1];
    pos[idx * 3 + 2] = e.origin[2] + (Math.random() - 0.5) * e.box[2];
    vel[idx * 3 + 0] = e.velocity[0] + (Math.random() - 0.5) * e.velocityJitter;
    vel[idx * 3 + 1] = e.velocity[1] + (Math.random() - 0.5) * e.velocityJitter;
    vel[idx * 3 + 2] = e.velocity[2] + (Math.random() - 0.5) * e.velocityJitter;
    age[idx] = 0;
    life[idx] = e.lifetime * (0.7 + Math.random() * 0.6);
    size[idx] = e.sizeMin + Math.random() * (e.sizeMax - e.sizeMin);
    color[idx * 3 + 0] = e.colorStart[0];
    color[idx * 3 + 1] = e.colorStart[1];
    color[idx * 3 + 2] = e.colorStart[2];
    alive[idx] = 1;
    sys.aliveCount++;
  }
  // Update.
  const g = sys.modules.gravity;
  const drag = Math.max(0, Math.min(0.5, sys.modules.drag));
  const curlAmp = sys.modules.curlAmp;
  const curlFreq = sys.modules.curlFreq;
  for (let i = 0; i < sys.maxParticles; i++) {
    if (!alive[i]) continue;
    age[i] += dtClamp;
    if (age[i] >= life[i]) {
      alive[i] = 0; sys.aliveCount--;
      continue;
    }
    vel[i * 3 + 0] += g[0] * dtClamp;
    vel[i * 3 + 1] += g[1] * dtClamp;
    vel[i * 3 + 2] += g[2] * dtClamp;
    vel[i * 3 + 0] *= (1 - drag);
    vel[i * 3 + 1] *= (1 - drag);
    vel[i * 3 + 2] *= (1 - drag);
    if (curlAmp !== 0) {
      const cx = perlin3(pos[i * 3] * curlFreq, pos[i * 3 + 1] * curlFreq, pos[i * 3 + 2] * curlFreq + 13);
      const cy = perlin3(pos[i * 3] * curlFreq + 27, pos[i * 3 + 1] * curlFreq, pos[i * 3 + 2] * curlFreq);
      const cz = perlin3(pos[i * 3] * curlFreq, pos[i * 3 + 1] * curlFreq + 51, pos[i * 3 + 2] * curlFreq);
      vel[i * 3 + 0] += cx * curlAmp * dtClamp;
      vel[i * 3 + 1] += cy * curlAmp * dtClamp;
      vel[i * 3 + 2] += cz * curlAmp * dtClamp;
    }
    pos[i * 3 + 0] += vel[i * 3 + 0] * dtClamp;
    pos[i * 3 + 1] += vel[i * 3 + 1] * dtClamp;
    pos[i * 3 + 2] += vel[i * 3 + 2] * dtClamp;
    const t = age[i] / life[i];
    color[i * 3 + 0] = e.colorStart[0] * (1 - t) + e.colorEnd[0] * t;
    color[i * 3 + 1] = e.colorStart[1] * (1 - t) + e.colorEnd[1] * t;
    color[i * 3 + 2] = e.colorStart[2] * (1 - t) + e.colorEnd[2] * t;
  }
  // Compact into front of the draw range so gl_PointSize ~ aSize works
  // we just upload the whole buffers and use drawRange = aliveCount.
  // (Simpler: leave at maxParticles and dead particles get aSize=0.)
  for (let i = 0; i < sys.maxParticles; i++) {
    if (!alive[i]) {
      size[i] = 0;
    }
  }
  sys.geo.attributes.position.needsUpdate = true;
  sys.geo.attributes.aSize.needsUpdate = true;
  sys.geo.attributes.aColor.needsUpdate = true;
  sys.geo.setDrawRange(0, sys.maxParticles);
}

export function destroySystem(id) {
  const sys = _systems.get(id);
  if (!sys) return { ok: false };
  unchainFromAnimTick(`niagara_${id}`);
  if (window.__archdiscScene) window.__archdiscScene.remove(sys.points);
  sys.geo.dispose();
  sys.points.material.dispose();
  _systems.delete(id);
  return { ok: true };
}

export function setEmitter(id, patch) {
  const sys = _systems.get(id);
  if (!sys) return { ok: false };
  Object.assign(sys.emitter, patch || {});
  return { ok: true };
}

export function setModules(id, patch) {
  const sys = _systems.get(id);
  if (!sys) return { ok: false };
  Object.assign(sys.modules, patch || {});
  return { ok: true };
}

export function setSpawnRate(id, rate) {
  const sys = _systems.get(id);
  if (!sys) return { ok: false };
  sys.spawnRate = Math.max(0, Number(rate) || 0);
  return { ok: true };
}

export function pause(id) { const s = _systems.get(id); if (!s) return { ok: false }; s.enabled = false; return { ok: true }; }
export function resume(id) { const s = _systems.get(id); if (!s) return { ok: false }; s.enabled = true; return { ok: true }; }

export function listSystems() {
  return {
    ok: true,
    systems: Array.from(_systems.values()).map((s) => ({
      id: s.id, max: s.maxParticles, alive: s.aliveCount, enabled: s.enabled,
    })),
  };
}

export function getStats(id) {
  const sys = _systems.get(id);
  if (!sys) return { ok: false };
  return { ok: true, max: sys.maxParticles, alive: sys.aliveCount, spawnRate: sys.spawnRate, enabled: sys.enabled };
}
