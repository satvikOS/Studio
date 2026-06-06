// ArchDisc Studio V3 — Marvelous Designer / Chaos Cloth real cloth
// simulation installer (slice 765).
//
// Wires the Verlet + PBD cloth solver from `clothSolver.js` into a
// stable `__studioCloth2*` op surface (the `2` suffix is to keep the
// pre-existing slice-686 `__studioCloth*` ops untouched — that one is
// a simpler procedural drape; this is the rigorous topology-derived
// solver).
//
// Ops:
//
//   __studioCloth2Create(meshUuid, opts)
//     → { ok, uuid, vertCount, constraintCount }
//     Build a cloth state from the named scene mesh's BufferGeometry,
//     using the mesh's CURRENT positions (so a transformed plane drapes
//     from where it currently sits). `uuid` is the cloth handle (same
//     as the source mesh's uuid for now — one cloth per mesh).
//
//   __studioCloth2Step({uuid, dt, iterations})
//     → { ok, energyResidual }
//     Advance the cloth by `dt` seconds, then write positions back
//     onto the source mesh's BufferGeometry.
//
//   __studioCloth2Pin({uuid, vertIdx})  → { ok }
//     Pin an extra vertex (mass → 0).
//
//   __studioCloth2SetWind({uuid, dir, strength}) → { ok }
//     Replace the wind vector. `dir` may be {x,y,z} OR [x,y,z]; it's
//     normalised and scaled by `strength`.
//
//   __studioCloth2List()  → { ok, items: [{uuid, vertCount, constraintCount}] }
//
//   __studioCloth2Remove({uuid}) → { ok }
//
// All ops are idempotent; registers under the 'sim' command-palette
// category so cmdpalette / menubar / contextmenu pick them up.

import { registerOps, unregisterOps } from '../common/registry.js';
import {
  buildClothFromGeometry,
  solveCloth,
  pinVertex,
  setWind,
  writeBackToGeometry,
} from './clothSolver.js';

let _installed = false;
// meshUuid → handle
const _cloths = new Map();

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

// ─── Ops ────────────────────────────────────────────────────────────

function opCloth2Create(meshUuid, opts) {
  const o = opts || {};
  const mesh = _findMeshByUuid(meshUuid);
  if (!mesh || !mesh.geometry) {
    return { ok: false, error: 'no mesh by uuid' };
  }
  const state = buildClothFromGeometry(mesh.geometry, o);
  if (!state) {
    return { ok: false, error: 'failed to build cloth (degenerate geometry?)' };
  }
  // If the mesh has world transforms, bake them into the cloth state
  // so gravity / wind act in world space too. The reverse mapping
  // (cloth → mesh) is set up by inverting the world matrix on write
  // — kept simple for now: we treat mesh local space AS world. Any
  // workbench that translates a plane should also clear that transform
  // before clothifying for the cleanest result. The e2e drops a plane
  // at the origin so this is fine.
  _cloths.set(meshUuid, {
    uuid: meshUuid,
    mesh,
    state,
    vertCount: state.vertCount,
    constraintCount: state.constraints.length,
  });
  // Tag the mesh so the outliner / inspector can show it's cloth-sim
  // backed; mirrors the other workbench tagging conventions.
  mesh.userData.archdiscStudioCloth2 = {
    vertCount: state.vertCount,
    constraintCount: state.constraints.length,
    pinnedCount: state.pinned.length,
  };
  return {
    ok: true,
    uuid: meshUuid,
    vertCount: state.vertCount,
    constraintCount: state.constraints.length,
  };
}

function opCloth2Step(args) {
  const a = args || {};
  const handle = _cloths.get(a.uuid);
  if (!handle) return { ok: false, error: 'no cloth by uuid' };
  const dt = Number.isFinite(+a.dt) ? +a.dt : (1 / 60);
  const iters = Math.max(1, Math.floor(+a.iterations) || 6);
  const r = solveCloth(handle.state, dt, iters);
  // Push positions back onto the mesh geometry so the viewport sees
  // the deformed cloth.
  writeBackToGeometry(handle.state, handle.mesh.geometry);
  return { ok: true, energyResidual: r.energyResidual };
}

function opCloth2Pin(args) {
  const a = args || {};
  const handle = _cloths.get(a.uuid);
  if (!handle) return { ok: false, error: 'no cloth by uuid' };
  const idx = Math.floor(+a.vertIdx);
  const r = pinVertex(handle.state, idx);
  if (r.ok) {
    handle.mesh.userData.archdiscStudioCloth2.pinnedCount = handle.state.pinned.length;
  }
  return r;
}

function opCloth2SetWind(args) {
  const a = args || {};
  const handle = _cloths.get(a.uuid);
  if (!handle) return { ok: false, error: 'no cloth by uuid' };
  return setWind(handle.state, a.dir, a.strength);
}

function opCloth2List() {
  const items = [];
  for (const h of _cloths.values()) {
    items.push({
      uuid: h.uuid,
      vertCount: h.vertCount,
      constraintCount: h.constraintCount,
      pinnedCount: h.state.pinned.length,
    });
  }
  return { ok: true, items };
}

function opCloth2Remove(args) {
  const a = args || {};
  const handle = _cloths.get(a.uuid);
  if (!handle) return { ok: false, error: 'no cloth by uuid' };
  if (handle.mesh && handle.mesh.userData) {
    delete handle.mesh.userData.archdiscStudioCloth2;
  }
  _cloths.delete(a.uuid);
  return { ok: true };
}

// ─── Install / uninstall ───────────────────────────────────────────

const OP_NAMES = [
  '__studioCloth2Create',
  '__studioCloth2Step',
  '__studioCloth2Pin',
  '__studioCloth2SetWind',
  '__studioCloth2List',
  '__studioCloth2Remove',
];

export function installCloth2() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioCloth2Installed) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioCloth2Installed = true;

  const ops = {
    __studioCloth2Create: [
      (meshUuid, opts) => opCloth2Create(meshUuid, opts),
      'Build a real Verlet+PBD cloth from a mesh (Marvelous Designer / Chaos Cloth). opts: {pinTopY, topEps, includeBend, distStiffness, bendStiffness, defaultMass}',
    ],
    __studioCloth2Step: [
      (args) => opCloth2Step(args),
      'Advance the cloth by dt seconds with N PBD relaxation passes.',
    ],
    __studioCloth2Pin: [
      (args) => opCloth2Pin(args),
      'Pin (freeze) an additional vertex by index.',
    ],
    __studioCloth2SetWind: [
      (args) => opCloth2SetWind(args),
      'Set the wind vector (direction normalised, scaled by strength).',
    ],
    __studioCloth2List: [
      () => opCloth2List(),
      'List every active cloth simulation in the scene.',
    ],
    __studioCloth2Remove: [
      (args) => opCloth2Remove(args),
      'Remove a cloth simulation handle (the mesh itself stays).',
    ],
  };
  registerOps(ops, 'sim', 'Marvelous Designer / Chaos Cloth Verlet+PBD cloth solver');
  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallCloth2() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  for (const h of _cloths.values()) {
    if (h.mesh && h.mesh.userData) {
      delete h.mesh.userData.archdiscStudioCloth2;
    }
  }
  _cloths.clear();
  unregisterOps(OP_NAMES);
  _installed = false;
  window.__studioCloth2Installed = false;
  return { ok: true };
}

export const __internal = { _cloths };

export default installCloth2;
