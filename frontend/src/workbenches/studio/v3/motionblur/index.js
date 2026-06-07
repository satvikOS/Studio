// ArchDisc Studio V3 — per-pixel motion blur (slice 810).
import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { on: false, samples: 8, strength: 1 };
export function installMotionBlur() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioMotionBlurEnable: ({ on, samples, strength } = {}) => {
      if (on != null) _state.on = !!on;
      if (samples != null) _state.samples = samples | 0;
      if (strength != null) _state.strength = strength;
      return { ok: true, ..._state };
    },
    __studioMotionBlurGetStats: () => ({ ok: true, ..._state }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'Per-pixel motion blur');
  return { ok: true };
}
export default installMotionBlur;
