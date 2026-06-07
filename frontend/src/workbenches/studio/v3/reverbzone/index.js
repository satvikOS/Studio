// ArchDisc Studio V3 — reverb zones (slice 850).
// Convolver-based reverb with impulse-response presets per zone.

import { registerOps } from '../common/registry.js';
let _installed = false;
const _PRESETS = ['none', 'room', 'hall', 'cathedral', 'cave', 'forest', 'tunnel', 'outdoor'];
const _zones = new Map();
function _genIR(ctx, preset) {
  const sampleRate = ctx.sampleRate;
  const lengthMap = { room: 0.5, hall: 2.0, cathedral: 4.5, cave: 3.0, forest: 0.8, tunnel: 2.5, outdoor: 0.3, none: 0 };
  const len = (lengthMap[preset] || 0.5) * sampleRate;
  const buf = ctx.createBuffer(2, Math.max(1, len), sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 2);
    }
  }
  return buf;
}
export function installReverbZone() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioReverbListPresets: () => ({ ok: true, presets: _PRESETS.slice() }),
    __studioReverbCreate: ({ id, preset = 'room' } = {}) => {
      if (typeof window === 'undefined') return { ok: false };
      let ctx;
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (_) { return { ok: false }; }
      const conv = ctx.createConvolver(); conv.buffer = _genIR(ctx, preset);
      _zones.set(id, { ctx, conv, preset });
      return { ok: true, id, preset };
    },
    __studioReverbSetPreset: ({ id, preset } = {}) => {
      const z = _zones.get(id); if (!z) return { ok: false };
      z.conv.buffer = _genIR(z.ctx, preset); z.preset = preset; return { ok: true };
    },
    __studioReverbList: () => ({ ok: true, ids: [..._zones.keys()] }),
    __studioReverbRemove: ({ id } = {}) => { _zones.delete(id); return { ok: true }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'audio', 'Reverb zones (convolver IR presets)');
  return { ok: true };
}
export default installReverbZone;
