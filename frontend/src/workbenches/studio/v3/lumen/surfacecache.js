// Slice 706 — Unreal Lumen-style real-time GI. Maintains a low-res
// "surface cache" — a per-mesh atlas of cached radiance values that
// converge over many frames via a single-bounce sample-from-environment
// pass per tick. Final scene gets a multiplicative GI tint by sampling
// the cache during render. Mirrors Lumen's infinite-bounce-via-cache.

import * as THREE from 'three';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';

const _caches = new Map();   // meshUuid → { tex: DataTexture, cells: Float32Array, accum: 0 }
let _enabled = false;
const CELLS = 16;     // CELLS × CELLS per-mesh radiance grid

function _envSampler() {
  // Use slice-704 HDRI importance sampler if installed, else uniform hemi.
  return (n) => {
    if (typeof window.__studioHDRISampleDirection === 'function') {
      const r = window.__studioHDRISampleDirection();
      if (r.ok) {
        const ndotl = Math.max(0, n.x * r.dir[0] + n.y * r.dir[1] + n.z * r.dir[2]);
        return { color: [ndotl, ndotl, ndotl], pdf: r.pdf };
      }
    }
    // Uniform sky (gradient).
    const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random(), Math.random() * 2 - 1).normalize();
    const ndotl = Math.max(0, n.dot(dir));
    return { color: [0.8 * ndotl, 0.85 * ndotl, 0.95 * ndotl], pdf: 1 / (4 * Math.PI) };
  };
}

function _ensureCache(mesh) {
  if (_caches.has(mesh.uuid)) return _caches.get(mesh.uuid);
  const cells = new Float32Array(CELLS * CELLS * 4);   // RGBA
  for (let i = 0; i < cells.length; i += 4) {
    cells[i] = 0.5; cells[i + 1] = 0.5; cells[i + 2] = 0.5; cells[i + 3] = 1;
  }
  const tex = new THREE.DataTexture(cells, CELLS, CELLS, THREE.RGBAFormat, THREE.FloatType);
  tex.magFilter = THREE.LinearFilter; tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const cache = { tex, cells, accum: 0 };
  _caches.set(mesh.uuid, cache);
  return cache;
}

function _accumulate(mesh, cache) {
  if (!mesh.geometry?.attributes?.position) return;
  const pos = mesh.geometry.attributes.position;
  const nrm = mesh.geometry.attributes.normal;
  if (!nrm) return;
  const cellsPerSample = 4;
  const sampleN = Math.min(cellsPerSample, pos.count);
  const sampleFn = _envSampler();
  cache.accum++;
  const blend = 1 / Math.min(64, cache.accum);
  for (let s = 0; s < sampleN; s++) {
    const i = Math.floor(Math.random() * pos.count);
    const n = new THREE.Vector3(nrm.array[i * 3], nrm.array[i * 3 + 1], nrm.array[i * 3 + 2]).normalize();
    const sample = sampleFn(n);
    // Map vertex index → atlas cell.
    const cell = i % (CELLS * CELLS);
    const idx = cell * 4;
    cache.cells[idx]     = cache.cells[idx]     * (1 - blend) + sample.color[0] * blend;
    cache.cells[idx + 1] = cache.cells[idx + 1] * (1 - blend) + sample.color[1] * blend;
    cache.cells[idx + 2] = cache.cells[idx + 2] * (1 - blend) + sample.color[2] * blend;
  }
  cache.tex.needsUpdate = true;
}

function _applyCacheToMaterial(mesh, cache) {
  // Best-effort: if material is MeshStandardMaterial, multiply envMapIntensity
  // and add a small light contribution via emissive.
  const mat = mesh.material;
  if (!mat || !mat.isMeshStandardMaterial) return;
  // Compute mean cell color.
  let sR = 0, sG = 0, sB = 0;
  const N = CELLS * CELLS;
  for (let i = 0; i < N; i++) {
    sR += cache.cells[i * 4];
    sG += cache.cells[i * 4 + 1];
    sB += cache.cells[i * 4 + 2];
  }
  sR /= N; sG /= N; sB /= N;
  if (!mat.userData.archdiscLumenEmissive) mat.userData.archdiscLumenEmissive = mat.emissive.clone();
  mat.emissive.setRGB(sR * 0.15, sG * 0.15, sB * 0.15);
  mat.emissiveIntensity = 1.0;
}

function _tickAll() {
  if (!_enabled || !window.__archdiscScene) return;
  window.__archdiscScene.traverseVisible((o) => {
    if (!o.isMesh || !o.material) return;
    const cache = _ensureCache(o);
    _accumulate(o, cache);
    _applyCacheToMaterial(o, cache);
  });
}

export function enable() {
  if (_enabled) return { ok: true };
  _enabled = true;
  chainIntoAnimTick('lumen', _tickAll);
  return { ok: true };
}

export function disable() {
  _enabled = false;
  unchainFromAnimTick('lumen');
  // Restore emissive.
  for (const [uuid] of _caches) {
    const mesh = window.__archdiscScene?.getObjectByProperty('uuid', uuid);
    if (mesh?.material?.userData.archdiscLumenEmissive) {
      mesh.material.emissive.copy(mesh.material.userData.archdiscLumenEmissive);
      delete mesh.material.userData.archdiscLumenEmissive;
    }
  }
  return { ok: true };
}

export function reset() {
  for (const c of _caches.values()) {
    for (let i = 0; i < c.cells.length; i += 4) {
      c.cells[i] = 0.5; c.cells[i + 1] = 0.5; c.cells[i + 2] = 0.5; c.cells[i + 3] = 1;
    }
    c.accum = 0;
    c.tex.needsUpdate = true;
  }
  return { ok: true };
}

export function stats() {
  return {
    ok: true,
    enabled: _enabled,
    meshes: _caches.size,
    avgAccum: _caches.size === 0
      ? 0
      : Array.from(_caches.values()).reduce((a, c) => a + c.accum, 0) / _caches.size,
  };
}
