// ArchDisc Studio V3 — Geometry-Nodes 2 install + window.__studioGN2* ops
// (slice 757).
//
// Five Blender Geometry-Nodes-style operators that extend the existing
// `geomnodes/` DAG without touching it (the existing graph and editor
// stay frozen). Each op resolves its target by uuid from the live
// scene, performs the op, swaps geometry in place when the target is
// a mesh (so the rest of the V3 surface keeps working: selection,
// outliner, save/load), or adds a fresh InstancedMesh in the
// instance-on-points case.
//
//   __studioGN2InstanceOnPoints(sourceUuid, points, opts) → { ok, uuid, count }
//   __studioGN2RealizeInstances(instancedUuid)            → { ok, uuid }
//   __studioGN2MergeByDistance(meshUuid, tolerance)       → { ok, mergedVerts }
//   __studioGN2TransformGeometry(meshUuid, matrix4Array)  → { ok }
//   __studioGN2Subdivide(meshUuid, levels)                → { ok, verts, faces }
//
// All five register with the V3 command palette under category
// 'geomnodes2' via the shared registry helper. Idempotent install.

import * as THREE from 'three';
import { registerOps, unregisterOps } from '../common/registry.js';
import { instanceOnPoints } from './instanceOnPoints.js';
import { realizeInstances } from './realizeInstances.js';
import { mergeByDistance } from './mergeByDistance.js';
import { transformGeometry } from './transformGeometry.js';
import { subdivideSurface } from './subdivisionSurface.js';

let _installed = false;

// ─── Helpers ─────────────────────────────────────────────────────────────
function _scene() {
  return (typeof window !== 'undefined') ? window.__archdiscScene : null;
}

function _resolveMesh(uuid) {
  const scene = _scene();
  if (!scene) return null;
  if (uuid) return scene.getObjectByProperty('uuid', uuid) || null;
  if (typeof window.__studioSelectedMesh === 'function') {
    try { return window.__studioSelectedMesh() || null; } catch (_) { return null; }
  }
  return null;
}

function _selectIfPossible(obj) {
  if (obj && typeof window !== 'undefined' && typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(obj); } catch (_) { /* ignore */ }
  }
}

// ─── Op 1: InstanceOnPoints ──────────────────────────────────────────────
function __studioGN2InstanceOnPoints(sourceUuid, points, opts) {
  const scene = _scene();
  if (!scene) return { ok: false, error: 'no scene' };
  const src = _resolveMesh(sourceUuid);
  if (!src || !src.geometry) return { ok: false, error: 'no source mesh' };
  const pts = Array.isArray(points) ? points : [];
  if (pts.length === 0) return { ok: false, error: 'no points' };
  const inst = instanceOnPoints(src, pts, opts || {});
  if (!inst) return { ok: false, error: 'instance build failed' };
  scene.add(inst);
  _selectIfPossible(inst);
  return { ok: true, uuid: inst.uuid, count: inst.count };
}

// ─── Op 2: RealizeInstances ──────────────────────────────────────────────
function __studioGN2RealizeInstances(instancedUuid) {
  const scene = _scene();
  if (!scene) return { ok: false, error: 'no scene' };
  const target = _resolveMesh(instancedUuid);
  if (!target || !target.isInstancedMesh) return { ok: false, error: 'not an InstancedMesh' };
  const r = realizeInstances(target);
  if (!r || !r.geometry) return { ok: false, error: 'realize failed' };

  // Replace the InstancedMesh with a baked THREE.Mesh in the same slot.
  const mat = target.material || new THREE.MeshStandardMaterial({ color: 0x9aa6b2 });
  const mesh = new THREE.Mesh(r.geometry, Array.isArray(mat) ? mat : mat.clone());
  mesh.name = `${target.name || 'realized'}-baked`;
  mesh.userData = mesh.userData || {};
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'realizedInstances';
  mesh.userData.archdiscStudioGeomNodes2 = 'realizeInstances';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // Preserve the local transform of the source InstancedMesh.
  mesh.position.copy(target.position);
  mesh.quaternion.copy(target.quaternion);
  mesh.scale.copy(target.scale);

  scene.add(mesh);
  scene.remove(target);
  try { target.geometry && target.geometry.dispose && target.geometry.dispose(); } catch (_) {}
  _selectIfPossible(mesh);
  return { ok: true, uuid: mesh.uuid, count: r.count, vertsPerInstance: r.vertsPerInstance };
}

// ─── Op 3: MergeByDistance ───────────────────────────────────────────────
function __studioGN2MergeByDistance(meshUuid, tolerance) {
  const m = _resolveMesh(meshUuid);
  if (!m || !m.geometry) return { ok: false, error: 'no mesh' };
  const tol = Number(tolerance) > 0 ? Number(tolerance) : 1e-4;
  const r = mergeByDistance(m.geometry, tol);
  if (!r || !r.geometry) return { ok: false, error: 'merge failed' };
  if (m.geometry.disposeBoundsTree) {
    try { m.geometry.disposeBoundsTree(); } catch (_) {}
  }
  try { m.geometry.dispose && m.geometry.dispose(); } catch (_) {}
  m.geometry = r.geometry;
  return { ok: true, mergedVerts: r.mergedVerts, vertsAfter: r.geometry.attributes.position.count };
}

// ─── Op 4: TransformGeometry ─────────────────────────────────────────────
function __studioGN2TransformGeometry(meshUuid, matrix4Array) {
  const m = _resolveMesh(meshUuid);
  if (!m || !m.geometry) return { ok: false, error: 'no mesh' };
  const r = transformGeometry(m.geometry, matrix4Array);
  if (!r || !r.ok) return r || { ok: false, error: 'transform failed' };
  return { ok: true, vertices: r.vertices };
}

// ─── Op 5: SubdivisionSurface ────────────────────────────────────────────
function __studioGN2Subdivide(meshUuid, levels) {
  const m = _resolveMesh(meshUuid);
  if (!m || !m.geometry) return { ok: false, error: 'no mesh' };
  const r = subdivideSurface(m, levels);
  if (!r || !r.geometry) return { ok: false, error: 'subdivide failed' };
  // catmullclark already swapped m.geometry in place; loop path returns a
  // fresh BufferGeometry that we still need to install.
  if (r.method !== 'catmullclark' && r.geometry !== m.geometry) {
    if (m.geometry.disposeBoundsTree) {
      try { m.geometry.disposeBoundsTree(); } catch (_) {}
    }
    try { m.geometry.dispose && m.geometry.dispose(); } catch (_) {}
    m.geometry = r.geometry;
  }
  return { ok: true, levels: r.levels, verts: r.verts, faces: r.faces, method: r.method };
}

// ─── Install ─────────────────────────────────────────────────────────────
export function installGeomNodes2() {
  if (typeof window === 'undefined') return { ok: false };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  const ops = {
    __studioGN2InstanceOnPoints: [
      __studioGN2InstanceOnPoints,
      'Geometry Nodes 2 — InstanceOnPoints (sourceUuid, points, opts)',
    ],
    __studioGN2RealizeInstances: [
      __studioGN2RealizeInstances,
      'Geometry Nodes 2 — RealizeInstances (instancedUuid)',
    ],
    __studioGN2MergeByDistance: [
      __studioGN2MergeByDistance,
      'Geometry Nodes 2 — MergeByDistance (meshUuid, tolerance)',
    ],
    __studioGN2TransformGeometry: [
      __studioGN2TransformGeometry,
      'Geometry Nodes 2 — TransformGeometry (meshUuid, matrix4Array)',
    ],
    __studioGN2Subdivide: [
      __studioGN2Subdivide,
      'Geometry Nodes 2 — SubdivisionSurface (meshUuid, levels)',
    ],
  };

  registerOps(ops, 'geomnodes2');
  return { ok: true, ops: 5 };
}

// For tests / hot-reload.
export function uninstallGeomNodes2() {
  if (!_installed) return { ok: true };
  _installed = false;
  unregisterOps([
    '__studioGN2InstanceOnPoints',
    '__studioGN2RealizeInstances',
    '__studioGN2MergeByDistance',
    '__studioGN2TransformGeometry',
    '__studioGN2Subdivide',
  ]);
  return { ok: true };
}

export default installGeomNodes2;
