// Slice 776 — Plasticity-style solid modeling history operations.
//
// Wraps `solidOps.js` into the Studio command-palette surface. Every op
// returns `{ok, uuid, vertCount?}` (or `{ok:false, error}` on failure)
// and pins the resulting mesh into `window.__archdiscScene` so the
// regular selection / transform / history-stack plumbing picks it up.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
import {
  solidRevolve, solidSweep, solidLoft, solidShell, solidChamfer,
} from './solidOps.js';

let _installed = false;
const _created = []; // [{uuid, kind, createdAt}]

function _scene() { return window.__archdiscScene || null; }

function _addToScene(geo, kind, color) {
  const scene = _scene();
  if (!scene) return { ok: false, error: 'no-scene' };
  const mat = new THREE.MeshStandardMaterial({
    color: color || 0xb8c0c8,
    roughness: 0.45,
    metalness: 0.15,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = `plasthist-${kind}`;
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = `plasthist-${kind}`;
  scene.add(mesh);
  _created.push({ uuid: mesh.uuid, kind, createdAt: Date.now() });
  if (typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(mesh); } catch (_) {}
  }
  return mesh;
}

function _vertCount(geo) {
  return geo && geo.attributes && geo.attributes.position
    ? geo.attributes.position.count
    : 0;
}

function _meshGeoAt(uuid) {
  const s = _scene();
  if (!s) return null;
  const m = s.getObjectByProperty('uuid', uuid);
  return m && m.geometry ? { mesh: m, geometry: m.geometry } : null;
}

// ── Op implementations ─────────────────────────────────────────────────

function __studioPlastRevolve(opts) {
  const { profile, axis, angle } = opts || {};
  const geo = solidRevolve(
    profile || [],
    axis || [0, 1, 0],
    typeof angle === 'number' ? angle : Math.PI * 2,
  );
  if (_vertCount(geo) === 0) return { ok: false, error: 'empty-profile' };
  const mesh = _addToScene(geo, 'revolve', 0xc8b89c);
  if (!mesh.ok && mesh.ok !== undefined) return mesh;
  return { ok: true, uuid: mesh.uuid, vertCount: _vertCount(geo) };
}

function __studioPlastSweep(opts) {
  const { profile, path } = opts || {};
  const geo = solidSweep(profile || [], path || []);
  if (_vertCount(geo) === 0) return { ok: false, error: 'empty-profile-or-path' };
  const mesh = _addToScene(geo, 'sweep', 0xa8c0b0);
  if (!mesh.ok && mesh.ok !== undefined) return mesh;
  return { ok: true, uuid: mesh.uuid, vertCount: _vertCount(geo) };
}

function __studioPlastLoft(opts) {
  const { profileA, profileB, samples } = opts || {};
  const geo = solidLoft(profileA || [], profileB || [], samples || 16);
  if (_vertCount(geo) === 0) return { ok: false, error: 'empty-profiles' };
  const mesh = _addToScene(geo, 'loft', 0xc0a8b8);
  if (!mesh.ok && mesh.ok !== undefined) return mesh;
  return { ok: true, uuid: mesh.uuid, vertCount: _vertCount(geo) };
}

function __studioPlastShell(opts) {
  const { meshUuid, thickness } = opts || {};
  const ref = _meshGeoAt(meshUuid);
  if (!ref) return { ok: false, error: 'mesh-not-found' };
  const geo = solidShell(ref.geometry, Number(thickness) || 0.05);
  if (_vertCount(geo) === 0) return { ok: false, error: 'shell-empty' };
  const mesh = _addToScene(geo, 'shell', 0xa8b8c0);
  if (!mesh.ok && mesh.ok !== undefined) return mesh;
  return { ok: true, uuid: mesh.uuid, vertCount: _vertCount(geo) };
}

function __studioPlastChamfer(opts) {
  const { meshUuid, distance } = opts || {};
  const ref = _meshGeoAt(meshUuid);
  if (!ref) return { ok: false, error: 'mesh-not-found' };
  // Chamfers all edges — pass an empty edgeIndices list so the kernel
  // falls into its "global pull-back" path.
  const geo = solidChamfer(ref.geometry, [], Number(distance) || 0.02);
  if (_vertCount(geo) === 0) return { ok: false, error: 'chamfer-empty' };
  const mesh = _addToScene(geo, 'chamfer', 0xb8a8c0);
  if (!mesh.ok && mesh.ok !== undefined) return mesh;
  return { ok: true, uuid: mesh.uuid, vertCount: _vertCount(geo) };
}

function __studioPlastList() {
  // Prune ghosts whose mesh has been removed by another path.
  const s = _scene();
  const live = s
    ? _created.filter((e) => !!s.getObjectByProperty('uuid', e.uuid))
    : _created.slice();
  return { ok: true, count: live.length, entries: live.slice() };
}

// ── Installer ──────────────────────────────────────────────────────────

export function installPlastHist() {
  if (_installed) return;
  _installed = true;
  const ops = {
    __studioPlastRevolve,
    __studioPlastSweep,
    __studioPlastLoft,
    __studioPlastShell,
    __studioPlastChamfer,
    __studioPlastList,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'edit',
    'Plasticity solid history ops — revolve / sweep / loft / shell / chamfer');
}
