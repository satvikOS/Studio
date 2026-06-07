// ArchDisc Studio V3 — ECS game runtime (slice 840).
// Entity / Component / System pattern. Entities are uuids; components
// are { kind, ...data }; systems run on tick over component queries.

import { registerOps } from '../common/registry.js';
let _installed = false;
const _entities = new Map();   // id → {components: Map<kind, data>}
const _systems = [];           // {name, queries:[kind...], fn:(ents,dt,ctx)=>void}
let _running = false;
let _tickRaf = null;

function _spawn(components = []) {
  const id = `e_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const map = new Map();
  for (const c of components) if (c?.kind) map.set(c.kind, c);
  _entities.set(id, { id, components: map });
  return id;
}
function _query(kinds) {
  const out = [];
  for (const e of _entities.values()) {
    if (kinds.every((k) => e.components.has(k))) out.push(e);
  }
  return out;
}
function _tick(dt = 0.016) {
  const ctx = { dt, scene: window.__archdiscScene };
  for (const sys of _systems) {
    try { sys.fn(_query(sys.queries), dt, ctx); } catch (_) {}
  }
}
function _loop() {
  if (!_running) return;
  _tick(0.016);
  _tickRaf = requestAnimationFrame(_loop);
}
export function installECS() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioECSSpawn: ({ components } = {}) => ({ ok: true, id: _spawn(components) }),
    __studioECSAddComponent: ({ id, component } = {}) => {
      const e = _entities.get(id); if (!e || !component?.kind) return { ok: false };
      e.components.set(component.kind, component); return { ok: true };
    },
    __studioECSRemoveComponent: ({ id, kind } = {}) => {
      const e = _entities.get(id); if (!e) return { ok: false };
      e.components.delete(kind); return { ok: true };
    },
    __studioECSDestroy: ({ id } = {}) => ({ ok: _entities.delete(id) }),
    __studioECSQuery: ({ kinds = [] } = {}) =>
      ({ ok: true, entities: _query(kinds).map((e) => ({ id: e.id, components: Object.fromEntries(e.components) })) }),
    __studioECSRegisterSystem: ({ name, queries = [], fn } = {}) => {
      if (typeof fn !== 'function') return { ok: false };
      _systems.push({ name, queries, fn });
      return { ok: true, count: _systems.length };
    },
    __studioECSTick: ({ dt } = {}) => { _tick(dt || 0.016); return { ok: true }; },
    __studioECSStart: () => { _running = true; if (!_tickRaf) _loop(); return { ok: true }; },
    __studioECSStop: () => { _running = false; if (_tickRaf) cancelAnimationFrame(_tickRaf); _tickRaf = null; return { ok: true }; },
    __studioECSStats: () => ({ ok: true, entities: _entities.size, systems: _systems.length, running: _running }),
    __studioECSClear: () => { _entities.clear(); _systems.length = 0; return { ok: true }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'game', 'ECS game runtime');
  return { ok: true };
}
export default installECS;
