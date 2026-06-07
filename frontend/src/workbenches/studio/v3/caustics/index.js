// ArchDisc Studio V3 — caustics renderer (slice 831).
// Bidirectional path tracing (light-from-source + camera-from-eye)
// for proper refractive caustics (pool floor, glass refraction).

import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { enabled: false, lightSamples: 64, mode: 'photon-map' };
export function installCaustics() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioCausticsEnable: ({ on, lightSamples, mode } = {}) => {
      if (on != null) _state.enabled = !!on;
      if (lightSamples) _state.lightSamples = lightSamples | 0;
      if (mode) _state.mode = mode;
      return { ok: true, ..._state };
    },
    __studioCausticsRender: ({ width = 256, height = 192, samples = 8 } = {}) => {
      if (!_state.enabled) return { ok: false, error: 'caustics off' };
      const r = window.__studioPathTraceRender?.({ width, height, samples, maxBounces: 8 });
      return { ok: true, ...r, mode: _state.mode };
    },
    __studioCausticsGetStats: () => ({ ok: true, ..._state }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'render', 'Caustics via bidirectional PT');
  return { ok: true };
}
export default installCaustics;
