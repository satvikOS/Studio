// ArchDisc Studio V3 — 3D spatial audio (slice 848).
// Web Audio API with PannerNode + HRTF for positional sound.

import { registerOps } from '../common/registry.js';
let _installed = false;
let _ctx = null;
const _sources = new Map();
function _ensureCtx() {
  if (_ctx || typeof window === 'undefined') return _ctx;
  try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { _ctx = null; }
  return _ctx;
}
export function installSpatial3D() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioAudioPlay3D: async ({ url, position = [0, 0, 0], loop = false, volume = 1 } = {}) => {
      const ctx = _ensureCtx(); if (!ctx) return { ok: false, error: 'no AudioContext' };
      try {
        const res = await fetch(url); const buf = await res.arrayBuffer();
        const audio = await ctx.decodeAudioData(buf);
        const source = ctx.createBufferSource(); source.buffer = audio; source.loop = loop;
        const panner = ctx.createPanner();
        panner.panningModel = 'HRTF'; panner.distanceModel = 'inverse';
        panner.positionX.value = position[0]; panner.positionY.value = position[1]; panner.positionZ.value = position[2];
        const gain = ctx.createGain(); gain.gain.value = volume;
        source.connect(panner); panner.connect(gain); gain.connect(ctx.destination);
        source.start();
        const id = `aud_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        _sources.set(id, { source, panner, gain });
        return { ok: true, id };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
    __studioAudioSetPosition: ({ id, position } = {}) => {
      const s = _sources.get(id); if (!s) return { ok: false };
      s.panner.positionX.value = position[0]; s.panner.positionY.value = position[1]; s.panner.positionZ.value = position[2];
      return { ok: true };
    },
    __studioAudioSetVolume: ({ id, volume } = {}) => {
      const s = _sources.get(id); if (!s) return { ok: false };
      s.gain.gain.value = volume; return { ok: true };
    },
    __studioAudioStop: ({ id } = {}) => {
      const s = _sources.get(id); if (!s) return { ok: false };
      try { s.source.stop(); } catch (_) {} _sources.delete(id); return { ok: true };
    },
    __studioAudioSetListener: ({ position = [0, 0, 0], forward = [0, 0, -1], up = [0, 1, 0] } = {}) => {
      const ctx = _ensureCtx(); if (!ctx) return { ok: false };
      const L = ctx.listener;
      if (L.positionX) {
        L.positionX.value = position[0]; L.positionY.value = position[1]; L.positionZ.value = position[2];
        L.forwardX.value = forward[0]; L.forwardY.value = forward[1]; L.forwardZ.value = forward[2];
        L.upX.value = up[0]; L.upY.value = up[1]; L.upZ.value = up[2];
      } else { L.setPosition(...position); L.setOrientation(...forward, ...up); }
      return { ok: true };
    },
    __studioAudioList: () => ({ ok: true, ids: [..._sources.keys()] }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'audio', '3D spatial audio (HRTF)');
  return { ok: true };
}
export default installSpatial3D;
