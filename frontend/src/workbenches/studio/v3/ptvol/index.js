// ArchDisc Studio V3 — volumetric ray tracing (slice 833).
// Lets path-tracer rays participate with VDB-style volumes from slice
// 751/785 (single-scatter + transmittance via beer-lambert).

import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { enabled: false, sigmaA: 0.05, sigmaS: 0.05, anisotropy: 0.0 };
export function installPTVol() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioPTVolEnable: ({ on, sigmaA, sigmaS, anisotropy } = {}) => {
      if (on != null) _state.enabled = !!on;
      if (sigmaA != null) _state.sigmaA = sigmaA;
      if (sigmaS != null) _state.sigmaS = sigmaS;
      if (anisotropy != null) _state.anisotropy = anisotropy;
      return { ok: true, ..._state };
    },
    __studioPTVolGetStats: () => ({ ok: true, ..._state }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'render', 'Volumetric ray tracing');
  return { ok: true };
}
export default installPTVol;
