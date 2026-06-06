// ArchDisc Studio V3 — hair grooming module installer (slice 760).
//
// Unreal Groom / Maya XGen / Blender Hair parity. The op surface
// `installGroom()` wires:
//
//   __studioGroomCreate(sourceMeshUuid, opts)
//     → { ok, uuid, strandCount }
//     Build `opts.count` strands of `opts.length` (segments default 8)
//     rooted on the named scene mesh; mount a LineSegments preview
//     under that mesh so the user sees the groom immediately. The
//     returned uuid is the strand mesh's, not the source's, so subsequent
//     ops address the groom directly.
//
//   __studioGroomComb({uuid, center, direction, radius, strength})
//     → { ok, perturbedCount }
//     Brush-comb every strand whose root is within `radius`. Center /
//     direction may be either {x,y,z} objects or [x,y,z] arrays (the
//     e2e prefers objects since they survive the JSON boundary cleanly
//     but both shapes work).
//
//   __studioGroomLength({uuid, lengthMul})
//     → { ok, newAvgLength }
//     Scale every interior point's offset from the root by `lengthMul`
//     in place. Preserves comb deformation.
//
//   __studioGroomList() → { ok, items: [{uuid, strandCount, mode}] }
//     Enumerate every groom currently in the scene. Stale handles whose
//     mesh has been removed from the scene are pruned before the
//     report.
//
//   __studioGroomRemove({uuid}) → { ok }
//     Tear down a groom: detach from parent, dispose geometry +
//     material, drop the handle.
//
//   __studioGroomSetMode({uuid, mode: 'lines' | 'ribbons'})
//     → { ok }
//     Swap the renderable between LineSegments and ribbon Mesh in
//     place. Preserves the strand store so any subsequent comb / length
//     keeps working on the new render.
//
// Idempotent. Registers under the 'groom' command-palette category so
// the cmdpalette / menubar / contextmenu groupings pick the ops up.
// Pure JS, zero new deps.

import * as THREE from 'three';
import { registerOp, unregisterOps } from '../common/registry.js';
import {
  generateStrands, combStrands, lengthStrands, densifyStrands,
} from './strands.js';
import { buildStrandLineMesh, buildStrandRibbonMesh } from './render.js';

let _installed = false;

// uuid (the renderable mesh's) → handle.
const _grooms = new Map();
const GROOM_TAG = 'archdiscStudioGroom';

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

function _disposeMesh(mesh) {
  if (!mesh) return;
  try {
    if (mesh.parent) mesh.parent.remove(mesh);
  } catch (_) { /* swallow */ }
  try {
    if (mesh.geometry && mesh.geometry.dispose) mesh.geometry.dispose();
  } catch (_) { /* swallow */ }
  try {
    if (mesh.material && mesh.material.dispose) mesh.material.dispose();
  } catch (_) { /* swallow */ }
}

function _buildRenderable(strands, mode, width) {
  if (mode === 'ribbons') {
    return buildStrandRibbonMesh(strands, width || 0.003);
  }
  return buildStrandLineMesh(strands);
}

// ─── Op implementations ──────────────────────────────────────────────

function opGroomCreate(sourceMeshUuid, opts) {
  const o = opts || {};
  const source = _findMeshByUuid(sourceMeshUuid);
  if (!source || !source.geometry) {
    return { ok: false, error: 'no source mesh by uuid' };
  }
  const count = Math.max(1, Math.floor(+o.count || 200));
  const length = Math.max(0, +o.length || 0.1);
  const segments = Math.max(1, Math.floor(+o.segments || 8));
  const seed = Number.isFinite(+o.seed) ? (+o.seed | 0) : 1337;
  const mode = (o.mode === 'ribbons') ? 'ribbons' : 'lines';
  const width = Math.max(0, +o.width || 0.003);

  const strands = generateStrands(source.geometry, count, length, segments, { seed });
  if (!strands.length) {
    return { ok: false, error: 'no strands generated (degenerate geometry?)' };
  }

  const mesh = _buildRenderable(strands, mode, width);
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'groom';
  mesh.userData[GROOM_TAG] = {
    sourceUuid: source.uuid,
    strandCount: strands.length,
    mode,
    length,
    segments,
    seed,
    width,
  };
  // Apply the source's world transform so the groom rides with the
  // source if the user has moved it (we duplicate world position /
  // rotation / scale because adding to source.parent is safer than
  // attaching as a child — the source might be a SkinnedMesh or other
  // exotic Object3D variant we don't want to mutate the hierarchy of).
  try { source.updateMatrixWorld(true); } catch (_) {}
  mesh.matrixAutoUpdate = true;
  mesh.position.copy(source.position);
  mesh.quaternion.copy(source.quaternion);
  mesh.scale.copy(source.scale);

  const s = _scene();
  if (s) s.add(mesh);

  _grooms.set(mesh.uuid, {
    uuid: mesh.uuid,
    sourceUuid: source.uuid,
    strands,
    mode,
    length,
    segments,
    seed,
    width,
    mesh,
  });

  if (typeof window !== 'undefined' && typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(mesh); } catch (_) {}
  }
  return { ok: true, uuid: mesh.uuid, strandCount: strands.length };
}

function _normaliseVec(v) {
  if (!v) return { x: 0, y: 0, z: 0 };
  if (Array.isArray(v)) return { x: +v[0] || 0, y: +v[1] || 0, z: +v[2] || 0 };
  return { x: +v.x || 0, y: +v.y || 0, z: +v.z || 0 };
}

function opGroomComb(args) {
  const a = args || {};
  const handle = _grooms.get(a.uuid);
  if (!handle) return { ok: false, error: 'no groom by uuid' };
  const center = _normaliseVec(a.center);
  const direction = _normaliseVec(a.direction);
  const radius = +a.radius || 0;
  const strength = Number.isFinite(+a.strength) ? +a.strength : 1;
  const r = combStrands(handle.strands, center, direction, radius, strength);
  // Rebuild the renderable from the mutated strand store. Swap the
  // geometry on the live mesh so the user keeps the same uuid (and the
  // outliner / selection don't blink).
  const fresh = _buildRenderable(handle.strands, handle.mode, handle.width);
  const old = handle.mesh.geometry;
  handle.mesh.geometry = fresh.geometry;
  try { old && old.dispose && old.dispose(); } catch (_) {}
  // The fresh mesh itself was a throwaway used to build the geometry —
  // free its material to keep the GPU happy.
  try { fresh.material && fresh.material.dispose && fresh.material.dispose(); } catch (_) {}
  return { ok: true, perturbedCount: r.perturbedCount };
}

function opGroomLength(args) {
  const a = args || {};
  const handle = _grooms.get(a.uuid);
  if (!handle) return { ok: false, error: 'no groom by uuid' };
  const lengthMul = Number.isFinite(+a.lengthMul) ? +a.lengthMul : 1;
  const r = lengthStrands(handle.strands, lengthMul);
  handle.length = r.newAvgLength;
  const fresh = _buildRenderable(handle.strands, handle.mode, handle.width);
  const old = handle.mesh.geometry;
  handle.mesh.geometry = fresh.geometry;
  try { old && old.dispose && old.dispose(); } catch (_) {}
  try { fresh.material && fresh.material.dispose && fresh.material.dispose(); } catch (_) {}
  return { ok: true, newAvgLength: r.newAvgLength };
}

function opGroomList() {
  const items = [];
  const s = _scene();
  // Reconcile against the scene so stale handles (mesh deleted via the
  // outliner) drop out of the report.
  const alive = new Set();
  if (s) {
    s.traverse((o) => {
      if (o && o.userData && o.userData[GROOM_TAG]) alive.add(o.uuid);
    });
  }
  for (const [uuid, h] of _grooms) {
    if (s && !alive.has(uuid)) { _grooms.delete(uuid); continue; }
    items.push({
      uuid,
      strandCount: h.strands.length,
      mode: h.mode,
    });
  }
  return { ok: true, items };
}

function opGroomRemove(args) {
  const a = args || {};
  const handle = _grooms.get(a.uuid);
  if (!handle) {
    // Maybe the mesh was deleted by another path; just clean up our
    // map so subsequent list() doesn't keep returning it.
    _grooms.delete(a.uuid);
    return { ok: false, error: 'no groom by uuid' };
  }
  _disposeMesh(handle.mesh);
  _grooms.delete(a.uuid);
  return { ok: true };
}

function opGroomSetMode(args) {
  const a = args || {};
  const handle = _grooms.get(a.uuid);
  if (!handle) return { ok: false, error: 'no groom by uuid' };
  const next = (a.mode === 'ribbons') ? 'ribbons' : 'lines';
  if (next === handle.mode) return { ok: true, mode: next, alreadyInMode: true };
  // Build the fresh renderable, swap geometry + material on the live
  // mesh, preserve uuid + transform + scene parent.
  const fresh = _buildRenderable(handle.strands, next, handle.width);
  const oldGeo = handle.mesh.geometry;
  const oldMat = handle.mesh.material;
  handle.mesh.geometry = fresh.geometry;
  handle.mesh.material = fresh.material;
  // Mode flips between LineSegments and Mesh — swap the prototype too
  // so .type / .isLineSegments / .isMesh reflect reality. We can't
  // change `__proto__` of an existing object reliably across THREE
  // versions, so we instead spawn a replacement mesh of the new class
  // with the same uuid + transform and re-parent it.
  const parent = handle.mesh.parent;
  if (parent) {
    parent.remove(handle.mesh);
  }
  const replacement = (next === 'ribbons')
    ? new THREE.Mesh(fresh.geometry, fresh.material)
    : new THREE.LineSegments(fresh.geometry, fresh.material);
  replacement.name = fresh.name;
  replacement.position.copy(handle.mesh.position);
  replacement.quaternion.copy(handle.mesh.quaternion);
  replacement.scale.copy(handle.mesh.scale);
  replacement.userData = Object.assign({}, handle.mesh.userData);
  replacement.userData[GROOM_TAG] = Object.assign(
    {}, replacement.userData[GROOM_TAG] || {}, { mode: next });
  replacement.userData.archdiscStudioGroomMode = next;
  // Preserve the uuid so the listing + outliner keep their reference.
  const keepUuid = handle.mesh.uuid;
  if (parent) parent.add(replacement);
  // Try to retain the original uuid; THREE allows direct assignment.
  try { replacement.uuid = keepUuid; } catch (_) { /* fall through */ }
  // Dispose what we no longer need. We swapped fresh.geometry onto
  // handle.mesh first and then onto replacement, so we mustn't dispose
  // fresh.geometry. We DO dispose the old geometry and old material we
  // displaced earlier in the function — those are no longer attached.
  try { oldGeo && oldGeo.dispose && oldGeo.dispose(); } catch (_) {}
  try { oldMat && oldMat.dispose && oldMat.dispose(); } catch (_) {}
  handle.mesh = replacement;
  handle.mode = next;
  // Re-register under the same uuid in the map (uuid retention may or
  // may not have stuck depending on THREE internals, so re-key).
  _grooms.delete(a.uuid);
  _grooms.set(replacement.uuid, handle);
  if (typeof window !== 'undefined' && typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(replacement); } catch (_) {}
  }
  return { ok: true, mode: next, uuid: replacement.uuid };
}

// Bonus density op for parity with the strands.js public surface and
// for use by the e2e if it wants to verify densify works. NOT in the
// brief's required ops list but trivially cheap to expose.
function opGroomDensify(args) {
  const a = args || {};
  const handle = _grooms.get(a.uuid);
  if (!handle) return { ok: false, error: 'no groom by uuid' };
  const m = Math.max(1, +a.multiplier || 1);
  const next = densifyStrands(handle.strands, m);
  handle.strands = next;
  const fresh = _buildRenderable(handle.strands, handle.mode, handle.width);
  const old = handle.mesh.geometry;
  handle.mesh.geometry = fresh.geometry;
  try { old && old.dispose && old.dispose(); } catch (_) {}
  try { fresh.material && fresh.material.dispose && fresh.material.dispose(); } catch (_) {}
  return { ok: true, strandCount: next.length };
}

// ─── Install / uninstall ────────────────────────────────────────────
const OP_NAMES = [
  '__studioGroomCreate',
  '__studioGroomComb',
  '__studioGroomLength',
  '__studioGroomList',
  '__studioGroomRemove',
  '__studioGroomSetMode',
  '__studioGroomDensify',
];

export function installGroom() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioGroomInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioGroomInstalled = true;
  const cat = 'groom';

  registerOp('__studioGroomCreate',
    (sourceUuid, opts) => opGroomCreate(sourceUuid, opts),
    cat,
    'Create a hair groom on a source mesh (Unreal Groom / Maya XGen / Blender Hair). opts: {count, length, segments, mode}');
  registerOp('__studioGroomComb',
    (args) => opGroomComb(args),
    cat,
    'Comb a groom: brush its strand tips along a direction within a radius of a centre point.');
  registerOp('__studioGroomLength',
    (args) => opGroomLength(args),
    cat,
    'Scale a groom\'s strand lengths in place by a multiplier; preserves combing.');
  registerOp('__studioGroomList',
    () => opGroomList(),
    cat,
    'List every groom currently in the scene.');
  registerOp('__studioGroomRemove',
    (args) => opGroomRemove(args),
    cat,
    'Remove a groom from the scene and dispose its geometry.');
  registerOp('__studioGroomSetMode',
    (args) => opGroomSetMode(args),
    cat,
    'Switch a groom between line and ribbon render modes.');
  registerOp('__studioGroomDensify',
    (args) => opGroomDensify(args),
    cat,
    'Increase a groom\'s strand count by interpolating between existing strands.');

  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallGroom() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  // Tear down every groom we own.
  for (const [, handle] of _grooms) {
    _disposeMesh(handle.mesh);
  }
  _grooms.clear();
  unregisterOps(OP_NAMES);
  _installed = false;
  window.__studioGroomInstalled = false;
  return { ok: true };
}

export const __internal = {
  _grooms,
  GROOM_TAG,
};

export default installGroom;
