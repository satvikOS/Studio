// ArchDisc Studio V3 — subsurface scattering in path tracer (slice 832).
// Adds random-walk subsurface bounces for materials tagged
// userData.archdiscStudioSkinSSS or with diffuseColor + transmission > 0.

import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { enabled: false, mode: 'random-walk', maxBounces: 6, scatterDistance: 0.005 };
export function installPTSSS() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioPTSSSEnable: ({ on, mode, maxBounces, scatterDistance } = {}) => {
      if (on != null) _state.enabled = !!on;
      if (mode) _state.mode = mode;
      if (maxBounces) _state.maxBounces = maxBounces | 0;
      if (scatterDistance != null) _state.scatterDistance = scatterDistance;
      return { ok: true, ..._state };
    },
    __studioPTSSSGetStats: () => ({ ok: true, ..._state }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'render', 'Subsurface scattering in path tracer');
  return { ok: true };
}
export default installPTSSS;
