// ArchDisc Studio V3 — Niagara-style real-time particle emitter module
// (slice 764).
//
// `installNia2()` wires the op surface:
//
//   __studioNia2Create(opts) → { ok, uuid, count, lifeMin, lifeMax }
//     Instantiate a new Emitter from `opts` (count / spawnRate /
//     lifeMin / lifeMax / velocityMin / velocityMax / gravity / drag /
//     colorOverLife / sizeOverLife / origin / baseSize / seed). Build
//     the matching InstancedMesh billboard renderable and parent it
//     under `window.__archdiscScene`. Returns the renderable mesh's
//     uuid as the handle for subsequent ops.
//
//   __studioNia2Tick({uuid, dt}) → { ok, aliveCount, particleSamples }
//     Advance the emitter by `dt` seconds, push the new state into the
//     mesh's instance buffers, and return:
//       • aliveCount: post-tick live particle count
//       • particleSamples: first 5 alive particles' { pos, life }
//     so a test can verify integration actually moved the particles.
//
//   __studioNia2Stop({uuid}) → { ok }
//     Reset the emitter (all slots → dead, RNG re-seeded, spawn
//     accumulator zeroed). The mesh stays in the scene so re-arming
//     via a subsequent Tick keeps the same uuid.
//
//   __studioNia2List() → { ok, items: [{uuid, count, aliveCount, ...}] }
//     Enumerate every emitter currently in the registry. Prunes
//     handles whose mesh has been removed from the scene by another
//     path so subsequent lookups don't return ghosts.
//
//   __studioNia2Remove({uuid}) → { ok }
//     Tear down an emitter: detach mesh from parent, dispose GPU
//     resources, drop the handle.
//
// Idempotent. Pure JS, no new deps. Registers ops under the 'fx'
// command-palette category (same bucket as Niagara / PFlow / Particle
// Flow / VFX).

import { registerOps, unregisterOps } from '../common/registry.js';
import { Emitter } from './emitter.js';
import {
  buildParticleMesh, updateParticleMesh, disposeParticleMesh,
} from './render.js';

let _installed = false;

// mesh.uuid → { emitter, mesh }
const _emitters = new Map();
const NIA2_TAG = 'archdiscStudioNia2';

function _scene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function _findMeshByUuid(uuid) {
  const s = _scene();
  if (!s || !uuid) return null;
  let m = null;
  s.traverse((o) => { if (!m && o.uuid === uuid) m = o; });
  return m;
}

// ─── Op implementations ────────────────────────────────────────────────

function opNia2Create(opts) {
  const o = opts || {};
  const emitter = new Emitter(o);
  const mesh = buildParticleMesh(emitter);
  // Stash the handle on the mesh too so a list traversal can recover
  // any emitter directly from the scene without consulting the map.
  mesh.userData[NIA2_TAG] = true;
  const s = _scene();
  if (s) s.add(mesh);
  _emitters.set(mesh.uuid, { emitter, mesh });
  if (typeof window !== 'undefined' && typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(mesh); } catch (_) {}
  }
  return {
    ok: true,
    uuid: mesh.uuid,
    count: emitter.count,
    lifeMin: emitter.lifeMin,
    lifeMax: emitter.lifeMax,
  };
}

function opNia2Tick(args) {
  const a = args || {};
  const handle = _emitters.get(a.uuid);
  if (!handle) return { ok: false, error: 'no emitter by uuid' };
  const dt = Number.isFinite(+a.dt) ? +a.dt : 0.016;
  handle.emitter.update(dt);
  updateParticleMesh(handle.mesh, handle.emitter);
  return {
    ok: true,
    aliveCount: handle.emitter.aliveCount,
    particleSamples: handle.emitter.sampleAlive(5),
  };
}

function opNia2Stop(args) {
  const a = args || {};
  const handle = _emitters.get(a.uuid);
  if (!handle) return { ok: false, error: 'no emitter by uuid' };
  handle.emitter.reset();
  // Push the cleared state into the mesh so the next render reflects
  // the stop immediately.
  updateParticleMesh(handle.mesh, handle.emitter);
  return { ok: true };
}

function opNia2List() {
  const s = _scene();
  const alive = new Set();
  if (s) {
    s.traverse((o) => {
      if (o && o.userData && o.userData[NIA2_TAG]) alive.add(o.uuid);
    });
  }
  const items = [];
  for (const [uuid, handle] of _emitters) {
    // Prune handles whose mesh was deleted via another path.
    if (s && !alive.has(uuid)) {
      _emitters.delete(uuid);
      continue;
    }
    items.push({
      uuid,
      count: handle.emitter.count,
      aliveCount: handle.emitter.aliveCount,
      spawnRate: handle.emitter.spawnRate,
      lifeMin: handle.emitter.lifeMin,
      lifeMax: handle.emitter.lifeMax,
      elapsed: handle.emitter.elapsed,
    });
  }
  return { ok: true, items };
}

function opNia2Remove(args) {
  const a = args || {};
  const handle = _emitters.get(a.uuid);
  if (!handle) {
    // Mesh may have been removed already by another path; ensure the
    // map doesn't keep returning it.
    _emitters.delete(a.uuid);
    return { ok: false, error: 'no emitter by uuid' };
  }
  disposeParticleMesh(handle.mesh);
  _emitters.delete(a.uuid);
  return { ok: true };
}

// ─── Install / uninstall ──────────────────────────────────────────────

const OP_NAMES = [
  '__studioNia2Create',
  '__studioNia2Tick',
  '__studioNia2Stop',
  '__studioNia2List',
  '__studioNia2Remove',
];

export function installNia2() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioNia2Installed) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioNia2Installed = true;
  const cat = 'fx';
  const ops = {
    __studioNia2Create: [opNia2Create,
      'Spawn a Niagara-style real-time particle emitter (gravity + drag + life + colour/size-over-life curves; renders as InstancedMesh billboards).'],
    __studioNia2Tick: [opNia2Tick,
      'Advance an emitter by dt seconds; returns aliveCount + first-5 particle samples for verification.'],
    __studioNia2Stop: [opNia2Stop,
      'Reset an emitter: all slots → dead, RNG re-seeded, spawn accumulator cleared. The mesh stays in the scene.'],
    __studioNia2List: [opNia2List,
      'List every Niagara-style emitter currently in the scene.'],
    __studioNia2Remove: [opNia2Remove,
      'Tear down an emitter, dispose its GPU resources, drop the handle.'],
  };
  registerOps(ops, cat, 'Niagara-style real-time particle emitter (slice 764).');
  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallNia2() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  for (const [, handle] of _emitters) {
    disposeParticleMesh(handle.mesh);
  }
  _emitters.clear();
  unregisterOps(OP_NAMES);
  _installed = false;
  window.__studioNia2Installed = false;
  return { ok: true };
}

export const __internal = {
  _emitters,
  NIA2_TAG,
};

export default installNia2;
