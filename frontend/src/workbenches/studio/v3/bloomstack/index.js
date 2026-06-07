// ArchDisc Studio V3 — bloom + post-process stack (slice 857).
// Configures unreal-style bloom + tone-mapping + vignette + film grain.

import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { bloom: { on: true, intensity: 0.8, threshold: 0.9, radius: 0.8 }, vignette: { on: true, intensity: 0.3 }, grain: { on: false, intensity: 0.05 }, chromAb: { on: false, intensity: 0.005 } };
export function installBloomStack() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioBloomSet: ({ on, intensity, threshold, radius } = {}) => {
      if (on != null) _state.bloom.on = !!on;
      if (intensity != null) _state.bloom.intensity = intensity;
      if (threshold != null) _state.bloom.threshold = threshold;
      if (radius != null) _state.bloom.radius = radius;
      return { ok: true, ..._state.bloom };
    },
    __studioVignetteSet: ({ on, intensity } = {}) => {
      if (on != null) _state.vignette.on = !!on;
      if (intensity != null) _state.vignette.intensity = intensity;
      return { ok: true, ..._state.vignette };
    },
    __studioGrainSet: ({ on, intensity } = {}) => {
      if (on != null) _state.grain.on = !!on;
      if (intensity != null) _state.grain.intensity = intensity;
      return { ok: true, ..._state.grain };
    },
    __studioChromAbSet: ({ on, intensity } = {}) => {
      if (on != null) _state.chromAb.on = !!on;
      if (intensity != null) _state.chromAb.intensity = intensity;
      return { ok: true, ..._state.chromAb };
    },
    __studioPostStackGetState: () => ({ ok: true, ..._state }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'Bloom + post-process stack');
  return { ok: true };
}
export default installBloomStack;
