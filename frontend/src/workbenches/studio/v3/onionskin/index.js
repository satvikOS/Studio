// ArchDisc Studio V3 — onion skinning (slice 808).
import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { on: false, framesBefore: 2, framesAfter: 2, opacity: 0.35 };
export function installOnionSkin() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioOnionSkinEnable: ({ on, framesBefore, framesAfter } = {}) => {
      if (on != null) _state.on = !!on;
      if (framesBefore != null) _state.framesBefore = framesBefore | 0;
      if (framesAfter != null) _state.framesAfter = framesAfter | 0;
      return { ok: true, ..._state };
    },
    __studioOnionSkinSetOpacity: ({ opacity = 0.35 } = {}) => { _state.opacity = opacity; return { ok: true }; },
    __studioOnionSkinGetStats: () => ({ ok: true, ..._state }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'anim', 'Onion skinning ghost frames');
  return { ok: true };
}
export default installOnionSkin;
