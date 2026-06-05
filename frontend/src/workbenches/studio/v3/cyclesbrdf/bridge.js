// Slice 697 — Cycles BRDF bridge: chains a tick that calls
// augmentSceneTextures() whenever the scene's material fingerprint
// changes; triggers __studioRTGPUResetAccumulation so the GPU PT
// re-converges with the fresh BRDF buffer in play.

import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';
import { augmentSceneTextures } from './sceneAugment.js';

let _enabled = false;
let _lastFingerprint = '';

function _fingerprint() {
  const scene = window.__archdiscScene;
  if (!scene) return '';
  const parts = [];
  scene.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    if (!m) return;
    parts.push(o.uuid, m.uuid, m.roughness ?? 0, m.metalness ?? 0, m.transmission ?? 0, m.emissiveIntensity ?? 0);
  });
  return parts.join(':');
}

function _tick() {
  if (!_enabled) return;
  const fp = _fingerprint();
  if (fp === _lastFingerprint) return;
  _lastFingerprint = fp;
  augmentSceneTextures();
  if (typeof window.__studioRTGPUResetAccumulation === 'function') {
    try { window.__studioRTGPUResetAccumulation(); } catch (_) {}
  }
}

export function enable() {
  if (_enabled) return { ok: true, on: true };
  _enabled = true;
  chainIntoAnimTick('cyclesBRDF', _tick);
  _tick();
  return { ok: true, on: true };
}

export function disable() {
  if (!_enabled) return { ok: true, on: false };
  _enabled = false;
  unchainFromAnimTick('cyclesBRDF');
  return { ok: true, on: false };
}

export function isEnabled() { return _enabled; }

export function forceRebuild() {
  _lastFingerprint = '';
  _tick();
  return { ok: true };
}

export function getMatBuffer() {
  const vp = window.__archdiscViewport;
  if (!vp || !vp.__studioRTGPUBRDF) return { ok: false, error: 'not built yet' };
  const r = vp.__studioRTGPUBRDF;
  return { ok: true, count: r.count, builtAt: r.lastBuiltAt };
}
