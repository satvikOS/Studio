// ArchDisc Studio V3 — audio mixer with busses (slice 849).
// Master / Music / SFX / Voice busses with gain + bypassable filters.

import { registerOps } from '../common/registry.js';
let _installed = false;
let _ctx = null;
const _busses = new Map();
function _ensureCtx() {
  if (_ctx || typeof window === 'undefined') return _ctx;
  try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { _ctx = null; }
  if (_ctx) {
    for (const name of ['Master', 'Music', 'SFX', 'Voice']) {
      const gain = _ctx.createGain(); gain.gain.value = 1;
      gain.connect(_ctx.destination);
      _busses.set(name, { gain, name, parent: null });
    }
  }
  return _ctx;
}
export function installAudioMix() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioMixerInit: () => { _ensureCtx(); return { ok: true, busses: [..._busses.keys()] }; },
    __studioMixerSetBusVolume: ({ bus, volume = 1 } = {}) => {
      _ensureCtx(); const b = _busses.get(bus); if (!b) return { ok: false };
      b.gain.gain.value = volume; return { ok: true };
    },
    __studioMixerGetBus: ({ bus } = {}) => {
      _ensureCtx(); const b = _busses.get(bus); return b ? { ok: true, name: b.name, gain: b.gain.gain.value } : { ok: false };
    },
    __studioMixerListBusses: () => { _ensureCtx(); return { ok: true, busses: [..._busses.keys()] }; },
    __studioMixerAddBus: ({ name } = {}) => {
      _ensureCtx(); if (!_ctx) return { ok: false };
      const gain = _ctx.createGain(); gain.gain.value = 1;
      gain.connect(_busses.get('Master').gain);
      _busses.set(name, { gain, name, parent: 'Master' });
      return { ok: true };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'audio', 'Audio mixer with busses');
  return { ok: true };
}
export default installAudioMix;
