// ArchDisc Studio V3 — Houdini POPs (Particle Operators) op surface
// (slice 777).
//
// `installPopFX()` wires the window.__studio* surface for the slice-777
// POP module. The full Houdini POP solver (forces, collisions, emitters)
// lives in `forces.js` + `popSolver.js`; this module is the thin glue
// that:
//   1. instantiates POPSolver instances from createOpts payloads
//   2. routes step / addForce / list / remove ops to the right instance
//   3. registers everything under the `fx` palette category alongside
//      Niagara (slice 764), Houdini POP chains (slice 727), RBD
//      destruction (slice 767), Cloth2 (slice 765).
//
// Op surface:
//   __studioPopCreate({count, emitter, life, forces, lifeMin, lifeMax,
//                      collision, seed, continuous}) → {ok, key, count}
//     Instantiate a POPSolver. `life` is a shorthand for `lifeMin =
//     lifeMax = life`. The returned `key` is the handle for subsequent
//     ops.
//
//   __studioPopStep({key, dt, sampleN}) → {ok, aliveCount, samplePositions}
//     Advance one timestep. Returns the post-step alive count + the
//     first `sampleN` (default 5) live particle positions so a test can
//     verify motion.
//
//   __studioPopAddForce({key, kind, params}) → {ok, forceCount}
//     Append a force to the solver's force stack. `kind` is one of
//     `gravity` / `wind` / `turbulence` / `curl` / `vortex` / `attractor`
//     (canonical list exported from forces.js#FORCE_KINDS).
//
//   __studioPopList() → {ok, items: [{key, count, aliveCount, forceCount,
//                                     elapsed}]}
//     Enumerate every solver currently registered.
//
//   __studioPopRemove({key}) → {ok}
//     Tear down a solver, drop its handle.
//
// Idempotent. Pure JS, no new deps.

import { registerOps, unregisterOps } from '../common/registry.js';
import { POPSolver } from './popSolver.js';
import { FORCE_KINDS } from './forces.js';

let _installed = false;

// key → POPSolver instance
const _solvers = new Map();
let _seq = 1;
function _genKey() { return `pop-${_seq++}-${Date.now().toString(36)}`; }

// ─── Op implementations ────────────────────────────────────────────────

function opPopCreate(opts) {
  const o = opts || {};
  const createOpts = {
    count: o.count,
    emitter: o.emitter,
    forces: o.forces,
    collision: o.collision,
    seed: o.seed,
    continuous: o.continuous,
    prefill: o.prefill,
  };
  // life shorthand: a scalar means both min+max.
  if (o.life != null && o.lifeMin == null && o.lifeMax == null) {
    createOpts.lifeMin = +o.life;
    createOpts.lifeMax = +o.life;
  } else {
    if (o.lifeMin != null) createOpts.lifeMin = +o.lifeMin;
    if (o.lifeMax != null) createOpts.lifeMax = +o.lifeMax;
  }
  const solver = new POPSolver(createOpts);
  const key = _genKey();
  _solvers.set(key, solver);
  return {
    ok: true,
    key,
    count: solver.count,
    lifeMin: solver.lifeMin,
    lifeMax: solver.lifeMax,
    forceCount: solver.forces.length,
  };
}

function opPopStep(args) {
  const a = args || {};
  const solver = _solvers.get(a.key);
  if (!solver) return { ok: false, error: 'no solver by key' };
  const dt = Number.isFinite(+a.dt) ? +a.dt : 0.016;
  const r = solver.step(dt);
  const sampleN = Number.isFinite(+a.sampleN) ? Math.max(0, +a.sampleN) : 5;
  return {
    ok: true,
    aliveCount: r.aliveCount,
    samplePositions: solver.samplePositions(sampleN),
    elapsed: solver.elapsed,
  };
}

function opPopAddForce(args) {
  const a = args || {};
  const solver = _solvers.get(a.key);
  if (!solver) return { ok: false, error: 'no solver by key' };
  if (!a.kind) return { ok: false, error: 'missing kind' };
  const n = solver.addForce(a.kind, a.params || {});
  return { ok: true, forceCount: n };
}

function opPopList() {
  const items = [];
  for (const [key, solver] of _solvers) {
    items.push({
      key,
      count: solver.count,
      aliveCount: solver.aliveCount(),
      forceCount: solver.forces.length,
      elapsed: solver.elapsed,
      lifeMin: solver.lifeMin,
      lifeMax: solver.lifeMax,
    });
  }
  return { ok: true, items, forceKinds: FORCE_KINDS.slice() };
}

function opPopRemove(args) {
  const a = args || {};
  const ok = _solvers.delete(a.key);
  return { ok };
}

// ─── Install / uninstall ──────────────────────────────────────────────

const OP_NAMES = [
  '__studioPopCreate',
  '__studioPopStep',
  '__studioPopAddForce',
  '__studioPopList',
  '__studioPopRemove',
];

export function installPopFX() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioPopFXInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioPopFXInstalled = true;
  const ops = {
    __studioPopCreate: [opPopCreate,
      'Spawn a Houdini-style POP solver (point/box/sphere emitter + force stack + ground collision).'],
    __studioPopStep: [opPopStep,
      'Advance one timestep; returns aliveCount + sampled positions.'],
    __studioPopAddForce: [opPopAddForce,
      'Append a force (gravity/wind/turbulence/curl/vortex/attractor) to a POP solver.'],
    __studioPopList: [opPopList,
      'List every POP solver currently registered.'],
    __studioPopRemove: [opPopRemove,
      'Tear down a POP solver, drop the handle.'],
  };
  registerOps(ops, 'fx',
    'Houdini POPs (Particle Operators) — gravity/wind/turbulence/curl/vortex/attractor + collision (slice 777).');
  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallPopFX() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  _solvers.clear();
  unregisterOps(OP_NAMES);
  _installed = false;
  window.__studioPopFXInstalled = false;
  return { ok: true };
}

export const __internal = {
  _solvers,
};

export default installPopFX;
