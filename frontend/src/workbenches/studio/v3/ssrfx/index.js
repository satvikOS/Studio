// ArchDisc Studio V3 — screen-space reflections (slice 796).
import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { on: false, samples: 16, maxDistance: 2, fadeStart: 0.7, intensity: 1 };
export function installSSRFX() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioSSREnable: ({ on, samples, maxDistance, fadeStart } = {}) => {
      if (on != null) _state.on = !!on;
      if (samples) _state.samples = samples | 0;
      if (maxDistance) _state.maxDistance = maxDistance;
      if (fadeStart != null) _state.fadeStart = fadeStart;
      return { ok: true, ..._state };
    },
    __studioSSRSetIntensity: ({ i = 1 } = {}) => { _state.intensity = i; return { ok: true }; },
    __studioSSRGetStats: () => ({ ok: true, ..._state }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Screen-space reflections');
  return { ok: true };
}
export default installSSRFX;
