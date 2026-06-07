// ArchDisc Studio V3 — input mapping (slice 843).
// Maps keyboard/mouse/gamepad events to named actions
// ("jump", "attack", "moveX"). Listeners + axis values.

import { registerOps } from '../common/registry.js';
let _installed = false;
const _bindings = new Map(); // action → [{type:'key|mouse|gp', code, axis?}]
const _state = { actions: {}, axes: {} };
const _keys = new Set();
let _hooked = false;
function _hookOnce() {
  if (_hooked || typeof window === 'undefined') return;
  _hooked = true;
  window.addEventListener('keydown', (e) => { _keys.add(e.code); _recompute(); });
  window.addEventListener('keyup',   (e) => { _keys.delete(e.code); _recompute(); });
}
function _recompute() {
  for (const [action, binds] of _bindings) {
    let pressed = false, axis = 0;
    for (const b of binds) {
      if (b.type === 'key' && _keys.has(b.code)) {
        pressed = true;
        if (b.axis) axis += b.axis;
      }
    }
    _state.actions[action] = pressed;
    _state.axes[action] = axis;
  }
}
export function installInputMap() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  _hookOnce();
  const ops = {
    __studioInputBind: ({ action, key, axis } = {}) => {
      const arr = _bindings.get(action) || [];
      arr.push({ type: 'key', code: key, axis: axis ?? 0 });
      _bindings.set(action, arr);
      return { ok: true };
    },
    __studioInputUnbind: ({ action } = {}) => { _bindings.delete(action); return { ok: true }; },
    __studioInputIsPressed: ({ action } = {}) => ({ ok: true, pressed: !!_state.actions[action] }),
    __studioInputGetAxis: ({ action } = {}) => ({ ok: true, value: _state.axes[action] || 0 }),
    __studioInputList: () => ({ ok: true, bindings: Object.fromEntries(_bindings) }),
    __studioInputGetState: () => ({ ok: true, actions: { ..._state.actions }, axes: { ..._state.axes } }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'game', 'Input mapping (kbd/gp)');
  return { ok: true };
}
export default installInputMap;
