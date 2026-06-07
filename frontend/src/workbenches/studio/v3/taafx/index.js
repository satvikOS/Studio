// ArchDisc Studio V3 — temporal anti-aliasing (slice 797).
import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { on: false, jitterScale: 1, historyWeight: 0.9, frameIdx: 0 };
function _halton(i, base) {
  let f = 1, r = 0;
  while (i > 0) { f /= base; r += f * (i % base); i = Math.floor(i / base); }
  return r;
}
export function installTAAFX() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioTAAEnable: ({ on, jitterScale, historyWeight } = {}) => {
      if (on != null) _state.on = !!on;
      if (jitterScale != null) _state.jitterScale = jitterScale;
      if (historyWeight != null) _state.historyWeight = historyWeight;
      return { ok: true, ..._state };
    },
    __studioTAAReset: () => { _state.frameIdx = 0; return { ok: true }; },
    __studioTAAGetStats: () => ({
      ok: true, ..._state,
      jitter: [_halton(_state.frameIdx, 2) - 0.5, _halton(_state.frameIdx, 3) - 0.5],
    }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Temporal anti-aliasing');
  return { ok: true };
}
export default installTAAFX;
