// ArchDisc Studio V3 — modifier stack + sculpt layers + mesh utility ops.
//
// V3-native ports of V2's modifier stack (slice 168), sculpt layer stack
// (slice 286), snap-to-vertex (slice 211), merge meshes (slice 363),
// symmetrize (slice 245), list/pick/clear edges (slice 217).

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function vp() { return window.__archdiscViewport || null; }
function scene() { return window.__archdiscScene || (vp() && vp().scene) || null; }
function activeMesh() {
  const v = vp();
  return (v && v.getSelected && v.getSelected()) || null;
}
function findMeshByUuid(uuid) {
  const s = scene(); if (!s) return null;
  let found = null;
  s.traverse((o) => { if (o.uuid === uuid) found = o; });
  return found;
}

// ─── Modifier stack (slice 168 V2 equivalent) ────────────────────────────
// Each Studio primitive carries a userData.archdiscStudioModStack of
// { base, mods: [] } where each mod is { type, params, enabled }.
// V3 keeps the stack model identical so save/load schemas stay portable.
function modStackInit(mesh) {
  if (!mesh.userData) mesh.userData = {};
  if (!mesh.userData.archdiscStudioModStack) {
    mesh.userData.archdiscStudioModStack = {
      base: { type: 'primitive', params: { kind: mesh.userData.archdiscStudioPrimitiveKind || 'cube', size: 1 } },
      mods: [],
    };
  }
  return mesh.userData.archdiscStudioModStack;
}
function modStackAdd(uuid, type, params = {}) {
  const m = findMeshByUuid(uuid) || activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const stack = modStackInit(m);
  const mod = { id: `mod-${stack.mods.length}-${Date.now()}`, type, params, enabled: true };
  stack.mods.push(mod);
  return { ok: true, id: mod.id, count: stack.mods.length };
}
function modStackRemove(uuid, modId) {
  const m = findMeshByUuid(uuid) || activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const stack = modStackInit(m);
  const before = stack.mods.length;
  stack.mods = stack.mods.filter((d) => d.id !== modId);
  return { ok: stack.mods.length < before, removed: before - stack.mods.length };
}
function modStackReorder(uuid, fromIdx, toIdx) {
  const m = findMeshByUuid(uuid) || activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const stack = modStackInit(m);
  if (fromIdx < 0 || fromIdx >= stack.mods.length || toIdx < 0 || toIdx >= stack.mods.length) return { ok: false, error: 'oob' };
  const [moved] = stack.mods.splice(fromIdx, 1);
  stack.mods.splice(toIdx, 0, moved);
  return { ok: true, order: stack.mods.map((d) => d.id) };
}
function modStackGet(uuid) {
  const m = findMeshByUuid(uuid) || activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const stack = modStackInit(m);
  return { ok: true, base: stack.base, mods: stack.mods.map((d) => ({ ...d, params: { ...d.params } })) };
}

// ─── Sculpt layers (slice 286 V2 equivalent) ─────────────────────────────
// Layers are non-destructive sculpt deltas. Each Studio mesh keeps
// userData.archdiscStudioSculptLayers: [{ id, name, enabled, strength,
// deltas: [vertIdx, dx, dy, dz, ...] }, ...]
function _layerStack(mesh) {
  if (!mesh.userData) mesh.userData = {};
  if (!Array.isArray(mesh.userData.archdiscStudioSculptLayers)) {
    mesh.userData.archdiscStudioSculptLayers = [];
  }
  return mesh.userData.archdiscStudioSculptLayers;
}
function sculptLayerAdd(name = 'Layer') {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const stack = _layerStack(m);
  const layer = { id: `sl-${stack.length}-${Date.now()}`, name, enabled: true, strength: 1, deltas: [] };
  stack.push(layer);
  return { ok: true, id: layer.id, count: stack.length };
}
function sculptLayerList() {
  const m = activeMesh(); if (!m) return [];
  return _layerStack(m).map((L) => ({ id: L.id, name: L.name, enabled: L.enabled, strength: L.strength }));
}
function sculptLayerToggle(idx) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const stack = _layerStack(m);
  if (idx < 0 || idx >= stack.length) return { ok: false, error: 'oob' };
  stack[idx].enabled = !stack[idx].enabled;
  return { ok: true, enabled: stack[idx].enabled };
}
function sculptLayerStrength(idx, strength) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const stack = _layerStack(m);
  if (idx < 0 || idx >= stack.length) return { ok: false, error: 'oob' };
  stack[idx].strength = strength;
  return { ok: true, strength };
}
function sculptLayerRemove(idx) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const stack = _layerStack(m);
  if (idx < 0 || idx >= stack.length) return { ok: false, error: 'oob' };
  const [gone] = stack.splice(idx, 1);
  return { ok: true, removed: gone.id };
}

// ─── Snap-to-vertex (slice 211 V2) ───────────────────────────────────────
// Move the active mesh so its closest world-space vert lands on the
// closest world-space vert of any other primitive within `range`.
function snapToVertex(range = 0.05) {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  m.updateMatrixWorld(true);
  const myPos = m.geometry && m.geometry.attributes && m.geometry.attributes.position;
  if (!myPos) return { ok: false, error: 'no geometry' };
  const myVerts = [];
  const tmp = new THREE.Vector3();
  for (let i = 0; i < myPos.count; i++) {
    tmp.fromBufferAttribute(myPos, i).applyMatrix4(m.matrixWorld);
    myVerts.push(tmp.clone());
  }
  let best = null; let bestDist = range;
  s.traverse((other) => {
    if (other === m || !other.userData || !other.userData.archdiscStudioPrimitive) return;
    if (!other.geometry || !other.geometry.attributes || !other.geometry.attributes.position) return;
    other.updateMatrixWorld(true);
    const op = other.geometry.attributes.position;
    for (let i = 0; i < op.count; i++) {
      tmp.fromBufferAttribute(op, i).applyMatrix4(other.matrixWorld);
      for (const mv of myVerts) {
        const d = tmp.distanceTo(mv);
        if (d < bestDist) {
          bestDist = d;
          best = { otherVert: tmp.clone(), myVert: mv.clone() };
        }
      }
    }
  });
  if (!best) return { ok: false, error: 'no snap target', range };
  const delta = best.otherVert.clone().sub(best.myVert);
  m.position.add(delta);
  m.updateMatrixWorld(true);
  return { ok: true, delta: [delta.x, delta.y, delta.z], distance: bestDist };
}

// ─── Merge meshes (slice 363 V2) ─────────────────────────────────────────
// Maya Combine / Blender Join — fuse N mesh geometries into one. Existing
// meshes get removed; the merged mesh is added to the scene with kind
// 'merged' and userData.archdiscStudioMergedFrom = [uuid, ...].
function mergeMeshes(uuids) {
  if (!Array.isArray(uuids) || uuids.length < 2) return { ok: false, error: 'need >= 2 uuids' };
  const s = scene(); if (!s) return { ok: false, error: 'no scene' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  const meshes = uuids.map(findMeshByUuid).filter(Boolean);
  if (meshes.length < 2) return { ok: false, error: 'meshes not found' };
  const geos = meshes.map((m) => {
    m.updateMatrixWorld(true);
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    // mergeGeometries needs identical attribute sets — strip extras.
    const keep = ['position'];
    for (const name of Object.keys(g.attributes)) if (!keep.includes(name)) g.deleteAttribute(name);
    return g;
  });
  const merged = mergeGeometries(geos, false);
  if (!merged) return { ok: false, error: 'mergeGeometries failed' };
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  const mat = meshes[0].material || new THREE.MeshStandardMaterial({ color: 0x9aa6b2 });
  const mesh = new THREE.Mesh(merged, mat);
  mesh.userData = {
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: 'merged',
    archdiscStudioMergedFrom: uuids.slice(),
  };
  s.add(mesh);
  // Remove the sources.
  for (const m of meshes) {
    s.remove(m);
    if (m.geometry) m.geometry.dispose();
  }
  return { ok: true, uuid: mesh.uuid, sourceCount: meshes.length, vertCount: merged.attributes.position.count };
}

// ─── Symmetrize (slice 245 V2) ───────────────────────────────────────────
// Mirror the active mesh's geometry across an axis and weld the two
// halves into one geometry. Keeps the +ve side, mirrors to -ve.
function symmetrize(axis = 'x') {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  const pos = m.geometry.attributes.position; if (!pos) return { ok: false, error: 'no positions' };
  const idx = m.geometry.index && m.geometry.index.array;
  if (!idx) return { ok: false, error: 'non-indexed geometry' };
  // Build duplicated verts; mirror axis-component negated.
  const outVerts = [];
  for (let i = 0; i < pos.count; i++) {
    outVerts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  const offset = pos.count;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (axis === 'x') outVerts.push(-x, y, z);
    else if (axis === 'y') outVerts.push(x, -y, z);
    else if (axis === 'z') outVerts.push(x, y, -z);
    else return { ok: false, error: 'bad axis' };
  }
  const outIdx = [];
  for (let i = 0; i < idx.length; i += 3) outIdx.push(idx[i], idx[i + 1], idx[i + 2]);
  // Mirrored triangles with reversed winding so normals point outward.
  for (let i = 0; i < idx.length; i += 3) outIdx.push(idx[i + 2] + offset, idx[i + 1] + offset, idx[i] + offset);
  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(outVerts, 3));
  newGeo.setIndex(outIdx);
  newGeo.computeVertexNormals();
  newGeo.computeBoundingSphere();
  m.geometry.dispose();
  m.geometry = newGeo;
  return { ok: true, axis, vertCount: newGeo.attributes.position.count, triCount: Math.floor(newGeo.index.array.length / 3) };
}

// ─── Edge listing / picking (slice 217 V2) ───────────────────────────────
function listEdges() {
  const m = activeMesh(); if (!m) return { ok: false, error: 'no mesh' };
  const idx = m.geometry.index && m.geometry.index.array;
  if (!idx) return { ok: false, error: 'non-indexed' };
  const set = new Map();
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f], b = idx[f + 1], c = idx[f + 2];
    const pairs = [[a, b], [b, c], [c, a]];
    for (const [u, v] of pairs) {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      if (!set.has(k)) set.set(k, [u < v ? u : v, u < v ? v : u]);
    }
  }
  return { ok: true, count: set.size, edges: Array.from(set.values()) };
}

// ─── Registration ────────────────────────────────────────────────────────
export function registerModOps() {
  window.__studioModStackAdd      = modStackAdd;
  window.__studioModStackRemove   = modStackRemove;
  window.__studioModStackReorder  = modStackReorder;
  window.__studioModStackGet      = modStackGet;
  window.__studioSculptLayerAdd      = sculptLayerAdd;
  window.__studioSculptLayerList     = sculptLayerList;
  window.__studioSculptLayerToggle   = sculptLayerToggle;
  window.__studioSculptLayerStrength = sculptLayerStrength;
  window.__studioSculptLayerRemove   = sculptLayerRemove;
  window.__studioSnapToVertex   = snapToVertex;
  window.__studioMergeMeshes    = mergeMeshes;
  window.__studioSymmetrize     = symmetrize;
  window.__studioListEdges      = listEdges;
}
export function unregisterModOps() {
  for (const k of [
    '__studioModStackAdd', '__studioModStackRemove', '__studioModStackReorder', '__studioModStackGet',
    '__studioSculptLayerAdd', '__studioSculptLayerList', '__studioSculptLayerToggle',
    '__studioSculptLayerStrength', '__studioSculptLayerRemove',
    '__studioSnapToVertex', '__studioMergeMeshes', '__studioSymmetrize', '__studioListEdges',
  ]) { try { delete window[k]; } catch (_) {} }
}
