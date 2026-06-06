// ArchDisc Studio V3 — Poisson-disk + density-mask scatter installer
// (slice 755).
//
// `installScatter()` wires the new Bridson surface sampler from
// `poissonSurface.js` to the v3 op surface. The brief lists five ops:
//
//   __studioScatterOnSurface(meshUuid, count, opts)
//     Run the sampler against a scene mesh's geometry and return the
//     raw point list as plain JSON (pos/normal as {x,y,z} triplets, uv
//     as {u,v}, plus the source faceIdx). The e2e consumes this
//     directly through `win.evaluate`, which is why every payload is
//     JSON-clean.
//
//   __studioScatterOnSurfaceInstanced(meshUuid, count, opts, instUuid?)
//     Same sampler, but the points are turned into a real
//     THREE.InstancedMesh added to the scene. When `instUuid` is
//     supplied and resolves to a mesh in the scene, its geometry +
//     material are reused for the instance; otherwise the installer
//     falls back to a tiny axis-aligned box so the scatter is visible
//     in the viewport without the caller having to author an asset
//     up front.
//
//   __studioScatterList()                  list of {uuid, count}
//   __studioScatterDelete(uuid)            remove a scatter from the
//                                          scene + registry
//   __studioScatterMaskList()              expose the named masks
//
// Idempotent. Registers under the 'scatter' command-palette category
// so the menubar / cmd-palette / right-click groupings pick it up.

import * as THREE from 'three';
import { registerOp, unregisterOps } from '../common/registry.js';
import { scatterOnSurface, MASK_REGISTRY } from './poissonSurface.js';

let _installed = false;

// uuid → { sourceUuid, count }. sourceUuid is the user-provided
// instance source mesh uuid when one was reused, otherwise null
// (i.e. the fallback unit cube was instanced).
const _scatterHandles = new Map();

const SCATTER_TAG = 'archdiscStudioScatter';

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

// Serialise a sampled point so it survives win.evaluate's JSON
// round-trip cleanly. THREE.Vector3 has its own toJSON but we want a
// flat {x, y, z} shape for ease of consumption in the test.
function _serializePoint(p) {
  return {
    pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
    normal: { x: p.normal.x, y: p.normal.y, z: p.normal.z },
    uv: { u: p.uv.u, v: p.uv.v },
    faceIdx: p.faceIdx,
  };
}

function _coerceOptsForSampler(meshOrNull, opts) {
  const o = opts ? Object.assign({}, opts) : {};
  // If the caller passed a mesh uuid, use its world matrix so the
  // resulting points are placed wherever the user has moved the
  // target in the scene.
  if (meshOrNull && !o.worldMatrix) {
    try {
      meshOrNull.updateMatrixWorld(true);
      o.worldMatrix = meshOrNull.matrixWorld;
    } catch (_) { /* fall through — use local space */ }
  }
  return o;
}

// ─── Op implementations ─────────────────────────────────────────────

function opScatterOnSurface(meshUuid, count, opts) {
  const mesh = _findMeshByUuid(meshUuid);
  if (!mesh || !mesh.geometry) {
    return { ok: false, error: 'no mesh by uuid', points: [],
      requested: +count || 0, accepted: 0 };
  }
  const o = _coerceOptsForSampler(mesh, opts);
  const r = scatterOnSurface(mesh.geometry, count, o);
  if (!r.ok) {
    return { ok: false, error: r.error, points: [],
      requested: r.requested, accepted: r.accepted };
  }
  return {
    ok: true,
    points: r.points.map(_serializePoint),
    requested: r.requested,
    accepted: r.accepted,
    truncated: !!r.truncated,
  };
}

// Tiny instance fallback so callers don't need to ship an asset to
// get a visible scatter.
function _defaultInstanceGeometryAndMaterial() {
  const g = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const m = new THREE.MeshStandardMaterial({
    color: 0x88aaff, roughness: 0.7, metalness: 0,
  });
  return { geometry: g, material: m, owned: true };
}

function opScatterOnSurfaceInstanced(meshUuid, count, opts, instanceSourceUuid) {
  const mesh = _findMeshByUuid(meshUuid);
  if (!mesh || !mesh.geometry) {
    return { ok: false, error: 'no target mesh by uuid' };
  }
  const o = _coerceOptsForSampler(mesh, opts);
  const r = scatterOnSurface(mesh.geometry, count, o);
  if (!r.ok || !r.points.length) {
    return { ok: false, error: r.error || 'scatter produced no points' };
  }
  // Resolve instance source.
  let geo = null, mat = null, ownGeo = false;
  let sourceUuid = null;
  if (instanceSourceUuid) {
    const src = _findMeshByUuid(instanceSourceUuid);
    if (src && src.isMesh && src.geometry && src.material) {
      geo = src.geometry;
      mat = src.material;
      sourceUuid = src.uuid;
    }
  }
  if (!geo || !mat) {
    const fb = _defaultInstanceGeometryAndMaterial();
    geo = fb.geometry; mat = fb.material; ownGeo = true;
  }
  const inst = new THREE.InstancedMesh(geo, mat, r.points.length);
  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0);
  const q = new THREE.Quaternion();
  for (let i = 0; i < r.points.length; i++) {
    const p = r.points[i];
    dummy.position.copy(p.pos);
    // Align local +Y to face normal so the instance sits flat on the
    // surface even on curved targets. Falls back to identity when the
    // normal is degenerate.
    if (p.normal.lengthSq() > 1e-12) {
      q.setFromUnitVectors(up, p.normal.clone().normalize());
      dummy.quaternion.copy(q);
    } else {
      dummy.quaternion.identity();
    }
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    inst.setMatrixAt(i, dummy.matrix);
  }
  inst.instanceMatrix.needsUpdate = true;
  inst.userData.archdiscStudioPrimitive = true;
  inst.userData.archdiscStudioPrimitiveKind = 'scatter';
  inst.userData[SCATTER_TAG] = {
    targetUuid: mesh.uuid,
    sourceUuid,
    count: r.points.length,
    truncated: !!r.truncated,
    ownGeometry: ownGeo,
  };
  inst.name = `studio-scatter-${r.points.length}`;
  const s = _scene();
  if (s) s.add(inst);
  _scatterHandles.set(inst.uuid, { sourceUuid, count: r.points.length });
  if (typeof window !== 'undefined' && typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(inst); } catch (_) { /* ignore */ }
  }
  return { ok: true, uuid: inst.uuid, count: r.points.length };
}

function opScatterList() {
  const items = [];
  // The map is the source of truth for "things this module created",
  // but stale entries are possible if a user deleted the mesh from
  // the outliner. Reconcile against the scene before reporting.
  const s = _scene();
  if (!s) {
    for (const [uuid, info] of _scatterHandles) {
      items.push({ uuid, count: info.count });
    }
    return { ok: true, items };
  }
  const alive = new Set();
  s.traverse((o) => {
    if (o && o.userData && o.userData[SCATTER_TAG]) alive.add(o.uuid);
  });
  for (const [uuid, info] of _scatterHandles) {
    if (!alive.has(uuid)) { _scatterHandles.delete(uuid); continue; }
    items.push({ uuid, count: info.count });
  }
  return { ok: true, items };
}

function opScatterDelete(uuid) {
  const s = _scene();
  if (!s) return { ok: false, error: 'no scene' };
  let target = null;
  s.traverse((o) => { if (!target && o.uuid === uuid) target = o; });
  if (!target) {
    _scatterHandles.delete(uuid);
    return { ok: false, error: 'no scatter by uuid' };
  }
  const parent = target.parent;
  if (parent) parent.remove(target);
  // Only dispose the geometry we created (the fallback box).
  const info = target.userData && target.userData[SCATTER_TAG];
  if (info && info.ownGeometry) {
    try { target.geometry && target.geometry.dispose && target.geometry.dispose(); } catch (_) {}
    try { target.material && target.material.dispose && target.material.dispose(); } catch (_) {}
  }
  try { target.dispose && target.dispose(); } catch (_) {}
  _scatterHandles.delete(uuid);
  return { ok: true };
}

function opScatterMaskList() {
  return { ok: true, names: Object.keys(MASK_REGISTRY) };
}

// ─── Install / uninstall ─────────────────────────────────────────────
const OP_NAMES = [
  '__studioScatterOnSurface',
  '__studioScatterOnSurfaceInstanced',
  '__studioScatterList',
  '__studioScatterDelete',
  '__studioScatterMaskList',
];

export function installScatter() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioScatterInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioScatterInstalled = true;
  const cat = 'scatter';

  registerOp('__studioScatterOnSurface',
    (uuid, count, opts) => opScatterOnSurface(uuid, count, opts),
    cat,
    'Bridson Poisson-disk scatter on a mesh surface; returns the JSON point list.');
  registerOp('__studioScatterOnSurfaceInstanced',
    (uuid, count, opts, instanceUuid) =>
      opScatterOnSurfaceInstanced(uuid, count, opts, instanceUuid),
    cat,
    'Poisson-disk scatter as a THREE.InstancedMesh (reuses instanceUuid if given).');
  registerOp('__studioScatterList',
    () => opScatterList(),
    cat,
    'List every scatter InstancedMesh currently in the scene.');
  registerOp('__studioScatterDelete',
    (uuid) => opScatterDelete(uuid),
    cat,
    'Remove a scatter from the scene and the internal registry.');
  registerOp('__studioScatterMaskList',
    () => opScatterMaskList(),
    cat,
    'List the named density masks the scatter ops accept.');

  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallScatter() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  // Tear down every scatter the module owns.
  const s = _scene();
  if (s) {
    const toDelete = [];
    s.traverse((o) => {
      if (o && o.userData && o.userData[SCATTER_TAG]) toDelete.push(o);
    });
    for (const o of toDelete) {
      try { opScatterDelete(o.uuid); } catch (_) {}
    }
  }
  _scatterHandles.clear();
  unregisterOps(OP_NAMES);
  _installed = false;
  window.__studioScatterInstalled = false;
  return { ok: true };
}

export const __internal = {
  _scatterHandles,
  SCATTER_TAG,
};

export default installScatter;
