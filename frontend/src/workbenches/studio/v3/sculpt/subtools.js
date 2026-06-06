// Slice 732 — ZBrush Subtools / subtool hierarchy.
//
// In ZBrush a "Tool" is a collection of independent SubTools — each its
// own watertight mesh with its own visibility, sculpt state, and
// polygroups — that together compose one model (e.g. a character's body,
// eyes, teeth, armour are separate subtools of one tool). The artist
// works one ACTIVE subtool at a time, can SOLO it (hide the rest),
// APPEND new subtools, DUPLICATE, DELETE, reorder, and MERGE-DOWN /
// merge-visible into a single mesh. (Mudbox layers, Nomad subtools, and
// Blender's "object as part of a collection" are the analogues.)
//
// Studio already spawns every primitive as a scene mesh marked
// `userData.archdiscStudioPrimitive`. This module layers a SubTool
// MANAGER over those meshes: an ordered list of { uuid, name } entries
// with one active index + a solo flag, plus the append/duplicate/merge
// operations. The manager is the single source of truth the (future)
// subtool palette renders; it never owns geometry — meshes stay in the
// scene so the outliner, BVH raycast, and exporters keep working.
//
// Pure JS + three; eval-free; deterministic.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { spawnPrimitive } from '../spawn.js';

function getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function meshByUuid(uuid) {
  const scene = getScene();
  if (!scene) return null;
  let m = null;
  scene.traverse((o) => { if (o.uuid === uuid) m = o; });
  return m;
}

// Every primitive mesh currently in the scene, in traversal order.
function scenePrimitives() {
  const scene = getScene();
  const out = [];
  if (!scene) return out;
  scene.traverse((o) => {
    if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) out.push(o);
  });
  return out;
}

// The manager state. `order` is the authoritative subtool list (array of
// uuids); `active` indexes into it; `solo` is the soloed uuid or null.
const _mgr = { order: [], active: 0, solo: null, seq: 1 };

// Reconcile the manager with the live scene: drop subtools whose mesh is
// gone, and append any scene primitive that isn't tracked yet (so meshes
// spawned by other tools show up as subtools automatically).
function sync() {
  const prims = scenePrimitives();
  const liveUuids = new Set(prims.map((m) => m.uuid));
  _mgr.order = _mgr.order.filter((u) => liveUuids.has(u));
  const tracked = new Set(_mgr.order);
  for (const m of prims) {
    if (!tracked.has(m.uuid)) {
      _mgr.order.push(m.uuid);
      if (!m.userData.subtoolName) {
        m.userData.subtoolName = `${(m.userData.archdiscStudioPrimitiveKind || 'mesh')}_${_mgr.seq++}`;
      }
    }
  }
  if (_mgr.active >= _mgr.order.length) _mgr.active = Math.max(0, _mgr.order.length - 1);
  if (_mgr.solo && !liveUuids.has(_mgr.solo)) _mgr.solo = null;
}

function entryFor(uuid) {
  const m = meshByUuid(uuid);
  if (!m) return null;
  const tris = m.geometry?.index
    ? m.geometry.index.count / 3
    : (m.geometry?.attributes?.position ? m.geometry.attributes.position.count / 3 : 0);
  return {
    uuid,
    name: m.userData.subtoolName || m.name || 'subtool',
    kind: m.userData.archdiscStudioPrimitiveKind || 'mesh',
    visible: m.visible !== false,
    triangles: Math.round(tris),
  };
}

// ── Public ops ──────────────────────────────────────────────────────

export function listSubtools() {
  sync();
  const items = _mgr.order.map((u, i) => {
    const e = entryFor(u);
    return e ? { ...e, index: i, active: i === _mgr.active, soloed: _mgr.solo === u } : null;
  }).filter(Boolean);
  return { ok: true, count: items.length, active: _mgr.active, solo: _mgr.solo, subtools: items };
}

export function getActiveSubtool() {
  sync();
  const uuid = _mgr.order[_mgr.active];
  if (!uuid) return { ok: false, error: 'no subtools' };
  const e = entryFor(uuid);
  // Keep window.__studioSelectMesh in sync so sculpt/edit ops target it.
  if (typeof window !== 'undefined' && typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(uuid); } catch (_) {}
  }
  return { ok: true, active: _mgr.active, subtool: e };
}

export function setActiveSubtool(indexOrUuid) {
  sync();
  let idx = -1;
  if (typeof indexOrUuid === 'number') idx = indexOrUuid;
  else idx = _mgr.order.indexOf(String(indexOrUuid));
  if (idx < 0 || idx >= _mgr.order.length) return { ok: false, error: 'bad subtool index/uuid' };
  _mgr.active = idx;
  return getActiveSubtool();
}

export function renameSubtool(indexOrUuid, name) {
  sync();
  const uuid = typeof indexOrUuid === 'number' ? _mgr.order[indexOrUuid] : String(indexOrUuid);
  const m = meshByUuid(uuid);
  if (!m) return { ok: false, error: 'no such subtool' };
  m.userData.subtoolName = String(name || '').trim() || m.userData.subtoolName;
  return { ok: true, uuid, name: m.userData.subtoolName };
}

export function setSubtoolVisible(indexOrUuid, visible) {
  sync();
  const uuid = typeof indexOrUuid === 'number' ? _mgr.order[indexOrUuid] : String(indexOrUuid);
  const m = meshByUuid(uuid);
  if (!m) return { ok: false, error: 'no such subtool' };
  m.visible = !!visible;
  return { ok: true, uuid, visible: m.visible };
}

// Solo the given subtool (hide every other); pass null/undefined to clear
// solo and restore all subtools visible.
export function soloSubtool(indexOrUuid) {
  sync();
  if (indexOrUuid === null || indexOrUuid === undefined) {
    _mgr.solo = null;
    for (const u of _mgr.order) { const m = meshByUuid(u); if (m) m.visible = true; }
    return { ok: true, solo: null };
  }
  const uuid = typeof indexOrUuid === 'number' ? _mgr.order[indexOrUuid] : String(indexOrUuid);
  if (!_mgr.order.includes(uuid)) return { ok: false, error: 'no such subtool' };
  _mgr.solo = uuid;
  for (const u of _mgr.order) { const m = meshByUuid(u); if (m) m.visible = (u === uuid); }
  return { ok: true, solo: uuid };
}

// Append a brand-new subtool (a fresh primitive). Becomes active.
export function appendSubtool(kind, name) {
  const scene = getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  if (typeof window !== 'undefined' && window.__studioPushUndo) window.__studioPushUndo();
  const mesh = spawnPrimitive(kind || 'sphere', scene);
  if (!mesh) return { ok: false, error: 'spawn failed' };
  mesh.userData.subtoolName = String(name || '').trim() || `${kind || 'sphere'}_${_mgr.seq++}`;
  sync();
  _mgr.active = _mgr.order.indexOf(mesh.uuid);
  return { ok: true, uuid: mesh.uuid, name: mesh.userData.subtoolName, index: _mgr.active };
}

// Duplicate a subtool (geometry + transform + material). Becomes active.
export function duplicateSubtool(indexOrUuid) {
  sync();
  const uuid = typeof indexOrUuid === 'number' ? _mgr.order[indexOrUuid] : String(indexOrUuid || _mgr.order[_mgr.active]);
  const src = meshByUuid(uuid);
  if (!src) return { ok: false, error: 'no such subtool' };
  const scene = getScene();
  if (typeof window !== 'undefined' && window.__studioPushUndo) window.__studioPushUndo();
  const clone = new THREE.Mesh(src.geometry.clone(), src.material.clone ? src.material.clone() : src.material);
  clone.position.copy(src.position);
  clone.rotation.copy(src.rotation);
  clone.scale.copy(src.scale);
  clone.position.x += 0.012; // small offset so the copy is visible
  clone.userData = { ...src.userData };
  clone.userData.subtoolName = `${src.userData.subtoolName || 'subtool'}_copy`;
  scene.add(clone);
  sync();
  _mgr.active = _mgr.order.indexOf(clone.uuid);
  return { ok: true, uuid: clone.uuid, name: clone.userData.subtoolName, index: _mgr.active };
}

export function deleteSubtool(indexOrUuid) {
  sync();
  const uuid = typeof indexOrUuid === 'number' ? _mgr.order[indexOrUuid] : String(indexOrUuid || _mgr.order[_mgr.active]);
  const m = meshByUuid(uuid);
  if (!m) return { ok: false, error: 'no such subtool' };
  if (typeof window !== 'undefined' && window.__studioPushUndo) window.__studioPushUndo();
  if (m.parent) m.parent.remove(m);
  if (m.geometry?.dispose) m.geometry.dispose();
  sync();
  return { ok: true, removed: uuid, remaining: _mgr.order.length };
}

// Merge a subtool DOWN into the one beneath it in the list (ZBrush
// "Merge Down"): combine the two geometries into a single mesh that
// replaces both. The merged mesh keeps the lower subtool's slot.
export function mergeDownSubtool(indexOrUuid) {
  sync();
  let idx = typeof indexOrUuid === 'number' ? indexOrUuid : _mgr.order.indexOf(String(indexOrUuid));
  if (idx < 0) idx = _mgr.active;
  if (idx <= 0) return { ok: false, error: 'nothing below to merge into' };
  const upper = meshByUuid(_mgr.order[idx]);
  const lower = meshByUuid(_mgr.order[idx - 1]);
  if (!upper || !lower) return { ok: false, error: 'merge targets missing' };
  return _mergeMeshes([lower, upper], lower, `${lower.userData.subtoolName}_merged`);
}

// Merge every VISIBLE subtool into one mesh (ZBrush "Merge Visible").
export function mergeVisibleSubtools() {
  sync();
  const meshes = _mgr.order.map(meshByUuid).filter((m) => m && m.visible !== false);
  if (meshes.length < 2) return { ok: false, error: 'need ≥2 visible subtools' };
  return _mergeMeshes(meshes, meshes[0], `${meshes[0].userData.subtoolName}_merged`);
}

// Internal — bake a list of meshes (world transforms applied) into a
// single merged mesh that replaces them; `keep` donates its slot/material.
function _mergeMeshes(meshes, keep, name) {
  const scene = getScene();
  if (typeof window !== 'undefined' && window.__studioPushUndo) window.__studioPushUndo();
  const geos = [];
  for (const m of meshes) {
    m.updateMatrixWorld(true);
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    // Strip attributes that mergeGeometries can't reconcile across meshes.
    const keepAttrs = new Set(['position', 'normal', 'uv']);
    for (const k of Object.keys(g.attributes)) if (!keepAttrs.has(k)) g.deleteAttribute(k);
    if (g.index) g.toNonIndexed && geos.push(g.toNonIndexed()); else geos.push(g);
  }
  const merged = mergeGeometries(geos.map((g) => g.index ? g.toNonIndexed() : g), false);
  if (!merged) return { ok: false, error: 'mergeGeometries failed' };
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  const mat = keep.material.clone ? keep.material.clone() : keep.material;
  const out = new THREE.Mesh(merged, mat);
  out.userData = { ...keep.userData };
  out.userData.subtoolName = name;
  // The merged mesh sits at world origin (geometry already in world space).
  out.position.set(0, 0, 0); out.rotation.set(0, 0, 0); out.scale.set(1, 1, 1);
  scene.add(out);
  // Remove all source meshes.
  for (const m of meshes) {
    if (m.parent) m.parent.remove(m);
    if (m.geometry?.dispose) m.geometry.dispose();
  }
  sync();
  _mgr.active = _mgr.order.indexOf(out.uuid);
  const tris = merged.attributes.position.count / 3;
  return { ok: true, uuid: out.uuid, name, triangles: Math.round(tris), merged: meshes.length };
}

// Reorder a subtool up (-1) or down (+1) in the list.
export function moveSubtool(indexOrUuid, delta) {
  sync();
  let idx = typeof indexOrUuid === 'number' ? indexOrUuid : _mgr.order.indexOf(String(indexOrUuid));
  if (idx < 0) return { ok: false, error: 'no such subtool' };
  const to = idx + (Number(delta) || 0);
  if (to < 0 || to >= _mgr.order.length) return { ok: false, error: 'out of range' };
  const [u] = _mgr.order.splice(idx, 1);
  _mgr.order.splice(to, 0, u);
  _mgr.active = to;
  return { ok: true, from: idx, to, order: _mgr.order.slice() };
}
