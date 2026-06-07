// ArchDisc Studio V3 — animation state machine (slice 861).
// Unreal/Unity-style "Anim State Machine" — idle/walk/run/jump with
// conditional transitions on bool/float parameters.

import { registerOps } from '../common/registry.js';
let _installed = false;
const _machines = new Map();
function _evalParams(machine, conds) {
  return conds.every((c) => {
    const v = machine.params[c.param];
    if (c.op === '==') return v === c.value;
    if (c.op === '>=') return v >= c.value;
    if (c.op === '<=') return v <= c.value;
    if (c.op === '>') return v > c.value;
    if (c.op === '<') return v < c.value;
    return false;
  });
}
function _tick(machine) {
  for (const t of (machine.transitions || [])) {
    if (machine.current === t.from && _evalParams(machine, t.conditions || [])) {
      machine.current = t.to;
      machine.timeInState = 0;
      try { t.onEnter?.(); } catch (_) {}
      return;
    }
  }
}
export function installAnimState() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioAnimStateCreate: ({ name, initial = 'Idle' } = {}) => {
      _machines.set(name, { name, current: initial, params: {}, transitions: [], states: new Set([initial]), timeInState: 0 });
      return { ok: true, name };
    },
    __studioAnimStateAddTransition: ({ name, from, to, conditions = [] } = {}) => {
      const m = _machines.get(name); if (!m) return { ok: false };
      m.transitions.push({ from, to, conditions });
      m.states.add(from); m.states.add(to);
      return { ok: true };
    },
    __studioAnimStateSetParam: ({ name, param, value } = {}) => {
      const m = _machines.get(name); if (!m) return { ok: false };
      m.params[param] = value; _tick(m); return { ok: true };
    },
    __studioAnimStateGetCurrent: ({ name } = {}) => {
      const m = _machines.get(name); if (!m) return { ok: false };
      return { ok: true, current: m.current, params: { ...m.params } };
    },
    __studioAnimStateList: () => ({ ok: true, names: [..._machines.keys()] }),
    __studioAnimStateDelete: ({ name } = {}) => { _machines.delete(name); return { ok: true }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'anim', 'Animation state machine');
  return { ok: true };
}
export default installAnimState;
