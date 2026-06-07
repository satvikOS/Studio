// ArchDisc Studio V3 — deferred renderer config (slice 853).
// Toggle for deferred G-buffer renderer (position/normal/albedo/depth).

import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { enabled: false, gbufferFormat: 'rgba16', maxLights: 64 };
export function installDeferred() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioDeferredEnable: ({ on, gbufferFormat, maxLights } = {}) => {
      if (on != null) _state.enabled = !!on;
      if (gbufferFormat) _state.gbufferFormat = gbufferFormat;
      if (maxLights) _state.maxLights = maxLights | 0;
      return { ok: true, ..._state };
    },
    __studioDeferredGetStats: () => ({ ok: true, ..._state }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Deferred renderer (G-buffer)');
  return { ok: true };
}
export default installDeferred;
