// Slice 697 — SDF Volume Builder: analytic CSG + marching cubes.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
import {
  makeScene, addOp, removeOp, reorderOp, evaluate, serialize, deserialize,
} from './scene.js';
import { marchingCubes } from './march.js';

let _installed = false;
const _scene = makeScene();

function _add(kind, params) {
  return addOp(_scene, kind, params);
}

function _list() {
  return { ok: true, count: _scene.ops.length, ops: _scene.ops.map((o) => ({ ...o })) };
}

function _setSmoothK(k) {
  _scene.smoothK = Math.max(0, Number(k) || 0);
  return { ok: true, k: _scene.smoothK };
}

function _generate(resolution, bounds) {
  if (!_scene.ops.length) return { ok: false, error: 'empty scene' };
  const scene3 = window.__archdiscScene;
  if (!scene3) return { ok: false, error: 'no archdisc scene' };
  const geo = marchingCubes((p) => evaluate(_scene, p), bounds, resolution || 64);
  const mat = new THREE.MeshStandardMaterial({ color: 0x9bc4e6, metalness: 0.1, roughness: 0.6, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'sdf_volume';
  mesh.userData = mesh.userData || {};
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'sdf-volume';
  scene3.add(mesh);
  if (typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(mesh); } catch (_) {}
  }
  return { ok: true, uuid: mesh.uuid, verts: geo.attributes.position.count };
}

function _clear() {
  _scene.ops.length = 0;
  return { ok: true };
}

function _export() { return { ok: true, json: serialize(_scene) }; }
function _import(json) {
  const s = deserialize(json);
  _scene.ops = s.ops;
  _scene.smoothK = s.smoothK;
  return { ok: true, count: _scene.ops.length };
}

export function installSDF() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioSDFAddOp: (kind, params) => _add(kind, params),
    __studioSDFRemoveOp: (uuid) => removeOp(_scene, uuid),
    __studioSDFReorderOp: (uuid, newIdx) => reorderOp(_scene, uuid, newIdx),
    __studioSDFSetSmoothBlend: _setSmoothK,
    __studioSDFListOps: _list,
    __studioSDFGenerateMesh: (resolution, bounds) => _generate(resolution, bounds),
    __studioSDFClear: _clear,
    __studioSDFExport: _export,
    __studioSDFImport: _import,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'edit', 'SDF Volume Builder — analytic CSG + marching cubes');
}
