// ArchDisc Studio V3 — FXAA / SMAA anti-aliasing (slice 859).
// Per-pixel edge-detection AA passes (alternative to slice 797 TAA).

import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { mode: 'fxaa', quality: 'medium', enabled: false };
const MODES = ['none', 'fxaa', 'smaa', 'taa'];
const QUALITIES = ['low', 'medium', 'high', 'ultra'];
export function installFXAASMAA() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioAAEnable: ({ on, mode, quality } = {}) => {
      if (on != null) _state.enabled = !!on;
      if (mode && MODES.includes(mode)) _state.mode = mode;
      if (quality && QUALITIES.includes(quality)) _state.quality = quality;
      return { ok: true, ..._state };
    },
    __studioAAListModes: () => ({ ok: true, modes: MODES.slice(), qualities: QUALITIES.slice() }),
    __studioAAGetStats: () => ({ ok: true, ..._state }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'FXAA / SMAA / TAA anti-aliasing');
  return { ok: true };
}
export default installFXAASMAA;
