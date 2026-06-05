// ArchDisc Studio V3 — subdiv edge-crease store.
//
// A crease is a per-edge weight in [0..1] that, during Loop
// subdivision, biases the edge mask toward the sharp midpoint
// (weight=1 → hold sharp; 0 → fully smooth). Creases live in
// `mesh.userData.archdiscStudioEdgeCreases` as a plain object
// `{ "i:j": weight, … }` keyed on WELDED vertex indices of the cage.
// Object form (not Map) ensures the data survives JSON serialise
// when scenes are saved.
//
// Helpers:
//   getCreaseStore(mesh)        → object (lazily allocated)
//   setEdgeCrease(uuid, k, w)   → seeds + writes
//   clearCreases(uuid)
//   listCreases(uuid)           → array of { i, j, weight }
//
// Edge keys are normalised by sortedKey().

import { edgeKey } from './loopSubdiv.js';

export const CREASE_KEY = 'archdiscStudioEdgeCreases';

function meshByUuid(uuid) {
  if (typeof window === 'undefined') return null;
  const scene = window.__archdiscScene;
  if (!scene || !uuid) return null;
  let hit = null;
  scene.traverse((o) => {
    if (hit) return;
    if (o.uuid === uuid && o.isMesh) hit = o;
  });
  return hit;
}

export function getCreaseStore(mesh) {
  if (!mesh) return null;
  mesh.userData = mesh.userData || {};
  if (!mesh.userData[CREASE_KEY] || typeof mesh.userData[CREASE_KEY] !== 'object') {
    mesh.userData[CREASE_KEY] = {};
  }
  return mesh.userData[CREASE_KEY];
}

// Convert the userData object to a Map<edgeKey,weight> the subdivider
// understands.
export function getCreaseMap(mesh) {
  const store = getCreaseStore(mesh);
  const m = new Map();
  if (!store) return m;
  for (const k of Object.keys(store)) {
    const w = Number(store[k]);
    if (Number.isFinite(w) && w > 0) m.set(k, Math.min(1, w));
  }
  return m;
}

export function setEdgeCrease(meshUuidOrMesh, i, j, weight) {
  const mesh = typeof meshUuidOrMesh === 'string'
    ? meshByUuid(meshUuidOrMesh)
    : meshUuidOrMesh;
  if (!mesh) return { ok: false, error: 'no mesh' };
  if (!Number.isInteger(i) || !Number.isInteger(j) || i === j) {
    return { ok: false, error: 'bad edge' };
  }
  const w = Math.max(0, Math.min(1, Number(weight) || 0));
  const store = getCreaseStore(mesh);
  const k = edgeKey(i, j);
  if (w === 0) {
    delete store[k];
  } else {
    store[k] = w;
  }
  return { ok: true, key: k, weight: w, count: Object.keys(store).length };
}

export function clearCreases(meshUuidOrMesh) {
  const mesh = typeof meshUuidOrMesh === 'string'
    ? meshByUuid(meshUuidOrMesh)
    : meshUuidOrMesh;
  if (!mesh) return { ok: false, error: 'no mesh' };
  mesh.userData = mesh.userData || {};
  mesh.userData[CREASE_KEY] = {};
  return { ok: true, count: 0 };
}

export function listCreases(meshUuidOrMesh) {
  const mesh = typeof meshUuidOrMesh === 'string'
    ? meshByUuid(meshUuidOrMesh)
    : meshUuidOrMesh;
  if (!mesh) return { ok: false, error: 'no mesh', count: 0, creases: [] };
  const store = getCreaseStore(mesh) || {};
  const out = [];
  for (const k of Object.keys(store)) {
    const w = Number(store[k]);
    if (!Number.isFinite(w) || w <= 0) continue;
    const [a, b] = k.split(':').map(Number);
    out.push({ i: a, j: b, weight: w, key: k });
  }
  // sort newest-/highest-weight first; stable behaviour for UI lists
  out.sort((p, q) => q.weight - p.weight || p.i - q.i || p.j - q.j);
  return { ok: true, count: out.length, creases: out };
}

export { meshByUuid };
