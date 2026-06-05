// ArchDisc Studio V3 — Plasticity-style subdivision surface wrapper.
//
// A subdiv surface is conceptually:
//
//   cage  →  Loop(cage, n levels)  →  live geometry
//
// We store the editable CAGE on `mesh.userData.archdiscStudioCage`
// (positions Float32Array + indices Uint32Array + welded vert count
// + per-vertex remap from the original) and replace the mesh's live
// geometry with the smoothed result so the viewport always renders
// the smooth surface. `setCageVertex` writes into the cage store
// then re-evaluates. `unwrap` restores the cage as the live geometry
// (a "destroy subsurf" op). `apply` bakes the smooth result into the
// cage permanently (the cage becomes the smooth mesh; any subdiv
// state is dropped).
//
// A hidden cage helper (LineSegments built from EdgesGeometry of the
// cage triangles) can be toggled via showCage(uuid, on) — used by
// the side panel "Show cage" checkbox.

import * as THREE from 'three';
import { loopSubdivide, computeFlatNormals } from './loopSubdiv.js';
import { getCreaseMap, meshByUuid } from './crease.js';

export const CAGE_KEY    = 'archdiscStudioCage';
export const LEVEL_KEY   = 'archdiscStudioSubdivLevel';
export const WRAPPED_KEY = 'archdiscStudioSubdivWrapped';
export const HELPER_KEY  = '__studioSubdivCageHelper';
export const DEFAULT_LEVELS = 2;

// Pull positions + welded indices from a mesh's geometry as the
// editable cage. Non-indexed geometries get implicit indices.
function extractCage(mesh) {
  const g = mesh.geometry;
  if (!g || !g.attributes || !g.attributes.position) return null;
  const pos = g.attributes.position;
  const positions = new Float32Array(pos.array.length);
  positions.set(pos.array);
  let indices;
  if (g.index) {
    indices = new Uint32Array(g.index.array.length);
    indices.set(g.index.array);
  } else {
    indices = new Uint32Array(pos.count);
    for (let i = 0; i < pos.count; i++) indices[i] = i;
  }
  return { positions, indices };
}

// Build smoothed BufferGeometry from a cage + crease map + level.
function buildSmoothGeometry(positions, indices, creases, levels) {
  const result = loopSubdivide(positions, indices, { creases, levels });
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(result.positions, 3));
  geom.setIndex(new THREE.BufferAttribute(result.indices, 1));
  const normals = computeFlatNormals(result.positions, result.indices);
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return { geom, smoothVerts: result.positions.length / 3, smoothFaces: result.indices.length / 3 };
}

// Remove any previously-attached cage line helper.
function removeCageHelper(mesh) {
  if (!mesh || !mesh.children) return;
  const stale = mesh.children.filter((c) => c.userData && c.userData[HELPER_KEY]);
  for (const c of stale) {
    if (c.geometry && c.geometry.dispose) c.geometry.dispose();
    if (c.material && c.material.dispose) c.material.dispose();
    mesh.remove(c);
  }
}

function addCageHelper(mesh) {
  const cage = mesh.userData && mesh.userData[CAGE_KEY];
  if (!cage) return;
  const tmp = new THREE.BufferGeometry();
  tmp.setAttribute('position', new THREE.Float32BufferAttribute(cage.positions, 3));
  tmp.setIndex(new THREE.BufferAttribute(cage.indices, 1));
  const edges = new THREE.EdgesGeometry(tmp, 1);
  const mat = new THREE.LineBasicMaterial({
    color: 0xff9d00,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
  });
  const lines = new THREE.LineSegments(edges, mat);
  lines.userData = {};
  lines.userData[HELPER_KEY] = true;
  lines.userData.isHelper = true;
  lines.renderOrder = 999;
  mesh.add(lines);
  tmp.dispose();
}

// ─── Public API ──────────────────────────────────────────────────────

export function wrap(meshUuidOrMesh, levels = DEFAULT_LEVELS) {
  const mesh = typeof meshUuidOrMesh === 'string'
    ? meshByUuid(meshUuidOrMesh)
    : meshUuidOrMesh;
  if (!mesh) return { ok: false, error: 'no mesh' };
  if (!mesh.geometry || !mesh.geometry.attributes.position) {
    return { ok: false, error: 'no geometry' };
  }
  const lv = Math.max(0, Math.min(6, Number(levels) || DEFAULT_LEVELS));

  mesh.userData = mesh.userData || {};
  // If already wrapped, refresh the cage from current userData rather
  // than re-snapshotting (which would lose user edits).
  let cage = mesh.userData[CAGE_KEY];
  if (!cage) {
    cage = extractCage(mesh);
    if (!cage) return { ok: false, error: 'no cage' };
    mesh.userData[CAGE_KEY] = cage;
  }
  const creases = getCreaseMap(mesh);
  const { geom, smoothVerts, smoothFaces } = buildSmoothGeometry(
    cage.positions, cage.indices, creases, lv,
  );

  if (mesh.geometry.dispose) mesh.geometry.dispose();
  mesh.geometry = geom;
  mesh.userData[LEVEL_KEY] = lv;
  mesh.userData[WRAPPED_KEY] = true;

  // BVH integration (Studio patches raycast w/ MeshBVH per memory).
  if (typeof mesh.geometry.computeBoundsTree === 'function') {
    try { mesh.geometry.computeBoundsTree(); } catch (_) {}
  }

  return {
    ok: true,
    cageVerts: cage.positions.length / 3,
    smoothVerts,
    smoothFaces,
    levels: lv,
  };
}

export function unwrap(meshUuidOrMesh) {
  const mesh = typeof meshUuidOrMesh === 'string'
    ? meshByUuid(meshUuidOrMesh)
    : meshUuidOrMesh;
  if (!mesh) return { ok: false, error: 'no mesh' };
  const cage = mesh.userData && mesh.userData[CAGE_KEY];
  if (!cage) return { ok: false, error: 'not wrapped' };

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(cage.positions, 3));
  geom.setIndex(new THREE.BufferAttribute(cage.indices, 1));
  const normals = computeFlatNormals(cage.positions, cage.indices);
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();

  if (mesh.geometry.dispose) mesh.geometry.dispose();
  mesh.geometry = geom;

  removeCageHelper(mesh);
  delete mesh.userData[CAGE_KEY];
  delete mesh.userData[LEVEL_KEY];
  delete mesh.userData[WRAPPED_KEY];

  if (typeof mesh.geometry.computeBoundsTree === 'function') {
    try { mesh.geometry.computeBoundsTree(); } catch (_) {}
  }

  return { ok: true, restoredVerts: cage.positions.length / 3 };
}

export function setLevel(meshUuidOrMesh, levels) {
  const mesh = typeof meshUuidOrMesh === 'string'
    ? meshByUuid(meshUuidOrMesh)
    : meshUuidOrMesh;
  if (!mesh) return { ok: false, error: 'no mesh' };
  const cage = mesh.userData && mesh.userData[CAGE_KEY];
  if (!cage) return { ok: false, error: 'not wrapped' };

  const lv = Math.max(0, Math.min(6, Number(levels) || 0));
  const creases = getCreaseMap(mesh);
  const { geom, smoothVerts, smoothFaces } = buildSmoothGeometry(
    cage.positions, cage.indices, creases, lv,
  );
  if (mesh.geometry.dispose) mesh.geometry.dispose();
  mesh.geometry = geom;
  mesh.userData[LEVEL_KEY] = lv;

  if (typeof mesh.geometry.computeBoundsTree === 'function') {
    try { mesh.geometry.computeBoundsTree(); } catch (_) {}
  }
  return { ok: true, levels: lv, smoothVerts, smoothFaces };
}

// Re-evaluate without changing the level — called by cageEdit after
// it writes into the cage store.
export function rebuild(meshUuidOrMesh) {
  const mesh = typeof meshUuidOrMesh === 'string'
    ? meshByUuid(meshUuidOrMesh)
    : meshUuidOrMesh;
  if (!mesh) return { ok: false, error: 'no mesh' };
  const cage = mesh.userData && mesh.userData[CAGE_KEY];
  if (!cage) return { ok: false, error: 'not wrapped' };
  const lv = Number(mesh.userData[LEVEL_KEY]);
  return setLevel(mesh, Number.isFinite(lv) ? lv : DEFAULT_LEVELS);
}

export function isWrapped(mesh) {
  return !!(mesh && mesh.userData && mesh.userData[WRAPPED_KEY]);
}

export function showCage(meshUuidOrMesh, on) {
  const mesh = typeof meshUuidOrMesh === 'string'
    ? meshByUuid(meshUuidOrMesh)
    : meshUuidOrMesh;
  if (!mesh) return { ok: false, error: 'no mesh' };
  removeCageHelper(mesh);
  if (on) addCageHelper(mesh);
  return { ok: true, on: !!on };
}

// Bake the current smooth result into the cage — i.e. the smoothed
// mesh becomes the new editable base, subdiv state is cleared.
export function apply(meshUuidOrMesh) {
  const mesh = typeof meshUuidOrMesh === 'string'
    ? meshByUuid(meshUuidOrMesh)
    : meshUuidOrMesh;
  if (!mesh) return { ok: false, error: 'no mesh' };
  if (!mesh.geometry || !mesh.geometry.attributes.position) {
    return { ok: false, error: 'no geometry' };
  }
  const cage = mesh.userData && mesh.userData[CAGE_KEY];
  if (!cage) return { ok: false, error: 'not wrapped' };

  // Replace the cage with the current (smoothed) geometry.
  const pos = mesh.geometry.attributes.position.array;
  const newCagePositions = new Float32Array(pos.length);
  newCagePositions.set(pos);
  let newCageIndices;
  if (mesh.geometry.index) {
    newCageIndices = new Uint32Array(mesh.geometry.index.array.length);
    newCageIndices.set(mesh.geometry.index.array);
  } else {
    newCageIndices = new Uint32Array(mesh.geometry.attributes.position.count);
    for (let i = 0; i < newCageIndices.length; i++) newCageIndices[i] = i;
  }
  // Cleanup: drop cage, level marker, wrapped flag, helper, creases
  // (they pointed at the OLD cage's welded indices and are no longer
  // meaningful against the baked geometry).
  delete mesh.userData[CAGE_KEY];
  delete mesh.userData[LEVEL_KEY];
  delete mesh.userData[WRAPPED_KEY];
  if (mesh.userData) {
    delete mesh.userData.archdiscStudioEdgeCreases;
  }
  removeCageHelper(mesh);

  // The live mesh geometry stays as-is (it IS the smoothed mesh now).
  // We don't need to re-tessellate — apply effectively means "promote
  // smoothed result to base, forget subdiv".
  return {
    ok: true,
    bakedVerts: newCagePositions.length / 3,
    bakedFaces: newCageIndices.length / 3,
  };
}

// Diagnostic helper used by the spec to assert the cage data is
// present + correctly sized.
export function getCage(meshUuidOrMesh) {
  const mesh = typeof meshUuidOrMesh === 'string'
    ? meshByUuid(meshUuidOrMesh)
    : meshUuidOrMesh;
  if (!mesh) return null;
  const cage = mesh.userData && mesh.userData[CAGE_KEY];
  if (!cage) return null;
  return {
    vertCount: cage.positions.length / 3,
    indexCount: cage.indices.length,
    levels: mesh.userData[LEVEL_KEY],
  };
}
