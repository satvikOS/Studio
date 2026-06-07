// ArchDisc Studio V3 — lens dirt shader (slice 858).
// Overlays a dirt/streak texture onto bright bloom areas — Unreal-style
// "dirty lens" cinematic look.

import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { enabled: false, intensity: 0.5, textureKind: 'streaks' };
const _KINDS = ['streaks', 'spots', 'water_droplets', 'fingerprint', 'sensor_dust'];
export function installLensDirt() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioLensDirtEnable: ({ on, intensity, textureKind } = {}) => {
      if (on != null) _state.enabled = !!on;
      if (intensity != null) _state.intensity = intensity;
      if (textureKind && _KINDS.includes(textureKind)) _state.textureKind = textureKind;
      return { ok: true, ..._state };
    },
    __studioLensDirtListKinds: () => ({ ok: true, kinds: _KINDS.slice() }),
    __studioLensDirtGetStats: () => ({ ok: true, ..._state }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'Lens dirt overlay');
  return { ok: true };
}
export default installLensDirt;
