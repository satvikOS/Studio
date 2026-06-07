// ArchDisc Studio V3 — game state machine (slice 846).
// FSM with named states, transitions, on-enter/on-exit hooks.
// Drives game menus, level progression, pause, etc.

import { registerOps } from '../common/registry.js';
let _installed = false;
const _machines = new Map();
export function installStateMachine() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioFSMCreate: ({ name, states = ['idle'], initial = 'idle' } = {}) => {
      _machines.set(name, { name, states: new Set(states), current: initial, transitions: new Map(), hooks: { onEnter: {}, onExit: {} } });
      return { ok: true, name };
    },
    __studioFSMAddTransition: ({ name, from, event, to } = {}) => {
      const m = _machines.get(name); if (!m) return { ok: false };
      const key = `${from}:${event}`;
      m.transitions.set(key, to);
      m.states.add(to); m.states.add(from);
      return { ok: true };
    },
    __studioFSMOnEnter: ({ name, state, fn } = {}) => {
      const m = _machines.get(name); if (!m || typeof fn !== 'function') return { ok: false };
      m.hooks.onEnter[state] = fn; return { ok: true };
    },
    __studioFSMOnExit: ({ name, state, fn } = {}) => {
      const m = _machines.get(name); if (!m || typeof fn !== 'function') return { ok: false };
      m.hooks.onExit[state] = fn; return { ok: true };
    },
    __studioFSMFire: ({ name, event } = {}) => {
      const m = _machines.get(name); if (!m) return { ok: false };
      const next = m.transitions.get(`${m.current}:${event}`);
      if (!next) return { ok: false, error: 'no transition' };
      try { m.hooks.onExit[m.current]?.(); } catch (_) {}
      const prev = m.current; m.current = next;
      try { m.hooks.onEnter[next]?.(); } catch (_) {}
      return { ok: true, from: prev, to: next };
    },
    __studioFSMGetState: ({ name } = {}) => {
      const m = _machines.get(name); if (!m) return { ok: false };
      return { ok: true, state: m.current, allStates: [...m.states] };
    },
    __studioFSMList: () => ({ ok: true, names: [..._machines.keys()] }),
    __studioFSMDelete: ({ name } = {}) => { _machines.delete(name); return { ok: true }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'game', 'Game state machine (FSM)');
  return { ok: true };
}
export default installStateMachine;
