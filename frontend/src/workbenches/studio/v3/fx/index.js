// ArchDisc Studio V3 — FX (particle depth) public installer.
//
// installFX() attaches every fx op to window.__studioFX*, then registers
// each with the central command palette under category 'fx'. It also
// owns the __studioFXTogglePlay master toggle which chains a fx tick
// into window.__archdiscViewport.__studioAnimTick. The fx tick:
//
//   1. Refreshes every collider's world AABB.
//   2. Walks every slice-632 particle system (window.__studioParticleSystems)
//      and applies force fields (forces.js) + bounces (collider.js)
//      *in addition to* whatever the slice-632 __studioParticleStep
//      already does. Slice 632's particle stepper handles gravity +
//      ageing + colour ramps; we augment with forces + collisions so the
//      existing system keeps working untouched while gaining depth.
//   3. Steps every hair instance (hair.js handles its own gravity, wind,
//      forces, constraints, and tube rebuild).
//
// Chain semantics match sim/index.js: chained.__fx = true, chained.__prev
// points at the prior tick, removeFXTick splices it back out.

import {
  hairCreate, hairSetLength, hairSetVariance, hairSetWind,
  hairStep, hairList, hairRemove, hairReset,
} from './hair.js';
import {
  addForce, removeForce, listForces, clearForces, applyForces,
} from './forces.js';
import {
  emitFromMesh, emitterRemove, emitterList,
} from './emitter.js';
import {
  addCollider, removeCollider, listColliders, clearColliders,
  refreshColliderBoxes, applyColliders,
} from './collider.js';
import { registerOp } from '../common/registry.js';
import { isChained, chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';

// ─── command-palette registration helper (delegates to common/) ────────
function reg(name, fn, description) {
  registerOp(name, fn, 'fx', description);
}

// ─── animation chain helpers (delegate to common/anim-tick.js) ─────────
function _hasFXTickIn(_viewport) { return isChained('fx'); }
function _removeFXTick(_viewport) { unchainFromAnimTick('fx'); }

// Per-particle scratch arrays — never reallocate inside the hot loop.
const _forceAccum   = [0, 0, 0];
const _colliderOut  = [0, 0, 0, 0, 0, 0];

// Augment slice-632 particle systems with forces + collisions. Slice
// 632's own __studioParticleStep handles gravity + lifetime; we apply
// force/collide effects to the same userData arrays so the next render
// pass sees the result.
function _augmentParticles(dt) {
  if (typeof window === 'undefined') return;
  const sys = window.__studioParticleSystems;
  if (!sys || !sys.length) return;
  for (let i = 0; i < sys.length; i++) {
    const pts = sys[i];
    const ud = pts && pts.userData && pts.userData.archdiscStudioParticles;
    if (!ud) continue;
    const pos = pts.geometry.attributes.position.array;
    const { vels, count } = ud;
    for (let j = 0; j < count; j++) {
      const o = j * 3;
      const px = pos[o], py = pos[o + 1], pz = pos[o + 2];
      const vx = vels[o], vy = vels[o + 1], vz = vels[o + 2];
      // Force fields: accumulate then integrate as velocity delta.
      applyForces(px, py, pz, vx, vy, vz, _forceAccum);
      let nvx = vx + _forceAccum[0] * dt;
      let nvy = vy + _forceAccum[1] * dt;
      let nvz = vz + _forceAccum[2] * dt;
      let npx = px, npy = py, npz = pz;
      // Colliders: AABB bounce with 0.5 restitution.
      const hit = applyColliders(npx, npy, npz, nvx, nvy, nvz, dt, 0.5, _colliderOut);
      if (hit) {
        npx = _colliderOut[0]; npy = _colliderOut[1]; npz = _colliderOut[2];
        nvx = _colliderOut[3]; nvy = _colliderOut[4]; nvz = _colliderOut[5];
        pos[o] = npx; pos[o + 1] = npy; pos[o + 2] = npz;
      }
      vels[o]     = nvx;
      vels[o + 1] = nvy;
      vels[o + 2] = nvz;
    }
    if (pts.geometry.attributes.position) pts.geometry.attributes.position.needsUpdate = true;
  }
}

const _state = { playing: false, last: 0 };

function _ensureFXTick() {
  const v = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  if (!v) return { ok: false, error: 'no viewport' };
  if (isChained('fx')) return { ok: true, alreadyChained: true };
  _state.last = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  return chainIntoAnimTick('fx', (t) => {
    const dt = Math.min(0.05, (t - _state.last) / 1000) || 0.016;
    _state.last = t;
    try { refreshColliderBoxes(); } catch (_) {}
    try { _augmentParticles(dt); } catch (_) {}
    try { hairStep(dt); } catch (_) {}
  });
}

function fxTogglePlay() {
  const v = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  if (!v) return { ok: false, error: 'no viewport' };
  if (_state.playing) {
    _state.playing = false;
    _removeFXTick(v);
    return { ok: true, playing: false };
  }
  _state.playing = true;
  _ensureFXTick();
  return { ok: true, playing: true };
}

function fxStatus() {
  let hair = 0, forces = 0, colliders = 0, emitters = 0;
  try { hair      = hairList().hairs.length;          } catch (_) {}
  try { forces    = listForces().forces.length;       } catch (_) {}
  try { colliders = listColliders().colliders.length; } catch (_) {}
  try { emitters  = emitterList().emitters.length;    } catch (_) {}
  return { ok: true, playing: _state.playing, hair, forces, colliders, emitters };
}

// ─── installer ──────────────────────────────────────────────────────────
export function installFX() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (window.__studioFXInstalled) return { ok: true, alreadyInstalled: true };
  window.__studioFXInstalled = true;

  // Hair.
  reg('__studioFXHairCreate',     (uuid, opts)  => hairCreate(uuid, opts),
    'Grow N hair strands from a source mesh’s vertex positions, sim under gravity + wind.');
  reg('__studioFXHairSetLength',  (uuid, len)   => hairSetLength(uuid, len),
    'Set the base length of every strand on a hair instance.');
  reg('__studioFXHairSetVariance',(uuid, v)     => hairSetVariance(uuid, v),
    'Re-roll per-strand length jitter (±variance fraction).');
  reg('__studioFXHairSetWind',    (vec)         => hairSetWind(vec),
    'Set the global wind vector applied to every hair strand.');
  reg('__studioFXHairStep',       (dt)          => hairStep(dt),
    'Advance every hair instance one Verlet + Jakobsen step.');
  reg('__studioFXHairList',       ()            => hairList(),
    'List every active hair instance.');
  reg('__studioFXHairReset',      (uuid)        => hairReset(uuid),
    'Snap a hair instance back to its initial straight configuration.');
  reg('__studioFXHairDelete',     (uuid)        => hairRemove(uuid),
    'Remove a hair instance from the scene and dispose its geometry.');

  // Force fields.
  reg('__studioFXForceAdd',       (kind, params) => addForce(kind, params),
    'Register a force field (attract / repel / vortex / drag) affecting particles + hair.');
  reg('__studioFXForceRemove',    (uuid)         => removeForce(uuid),
    'Remove a previously-registered force field by uuid.');
  reg('__studioFXForceList',      ()             => listForces(),
    'List every active force field with its kind + params.');
  reg('__studioFXForceClear',     ()             => clearForces(),
    'Remove every force field.');

  // Mesh emitter.
  reg('__studioFXEmitFromMesh',   (meshUuid, count, opts) => emitFromMesh(meshUuid, count, opts),
    'Spawn a slice-632-compatible particle system whose initial positions are the source mesh’s vertices.');
  reg('__studioFXEmitterRemove',  (uuid)                  => emitterRemove(uuid),
    'Remove a previously-spawned fx emitter particle system.');
  reg('__studioFXEmitterList',    ()                      => emitterList(),
    'List every fx mesh-emitter particle system.');

  // Colliders.
  reg('__studioFXColliderAdd',    (meshUuid) => addCollider(meshUuid),
    'Register a scene mesh as an AABB collider that bounces particles.');
  reg('__studioFXColliderRemove', (meshUuid) => removeCollider(meshUuid),
    'Unregister a collider by mesh uuid.');
  reg('__studioFXColliderList',   ()         => listColliders(),
    'List every registered collider.');
  reg('__studioFXColliderClear',  ()         => clearColliders(),
    'Remove every collider.');

  // Master.
  reg('__studioFXTogglePlay',     () => fxTogglePlay(),
    'Toggle the fx master tick — chains/splices forces + colliders + hair stepping into __studioAnimTick.');
  reg('__studioFXStatus',         () => fxStatus(),
    'Report fx playing state + per-type counts.');

  return { ok: true, alreadyInstalled: false };
}

export function uninstallFX() {
  if (typeof window === 'undefined') return { ok: false };
  const v = window.__archdiscViewport;
  if (v) _removeFXTick(v);
  _state.playing = false;
  for (const k of [
    '__studioFXHairCreate', '__studioFXHairSetLength', '__studioFXHairSetVariance',
    '__studioFXHairSetWind', '__studioFXHairStep', '__studioFXHairList',
    '__studioFXHairReset', '__studioFXHairDelete',
    '__studioFXForceAdd', '__studioFXForceRemove', '__studioFXForceList', '__studioFXForceClear',
    '__studioFXEmitFromMesh', '__studioFXEmitterRemove', '__studioFXEmitterList',
    '__studioFXColliderAdd', '__studioFXColliderRemove', '__studioFXColliderList', '__studioFXColliderClear',
    '__studioFXTogglePlay', '__studioFXStatus',
  ]) {
    try { delete window[k]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(k); } catch (_) {}
    }
  }
  window.__studioFXInstalled = false;
  return { ok: true };
}
