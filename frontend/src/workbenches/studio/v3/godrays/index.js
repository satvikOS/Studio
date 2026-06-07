// ArchDisc Studio V3 — volumetric god rays (slice 795).
import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { on: false, lightDir: [0.5, 1, 0.5], samples: 16, density: 0.5, intensity: 1 };
export function installGodRays() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioGodRaysEnable: ({ on, lightDir, samples, density } = {}) => {
      if (on != null) _state.on = !!on;
      if (lightDir) _state.lightDir = lightDir.slice();
      if (samples) _state.samples = samples | 0;
      if (density != null) _state.density = density;
      return { ok: true, ..._state };
    },
    __studioGodRaysSetIntensity: ({ i = 1 } = {}) => { _state.intensity = i; return { ok: true }; },
    __studioGodRaysGetStats: () => ({ ok: true, ..._state }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'Volumetric god rays');
  return { ok: true };
}
export default installGodRays;
