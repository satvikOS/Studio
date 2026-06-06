// Slice 767 — Houdini RBD destruction installer.
//
// Wires `voronoiFracture` + the chunk RBD sim into the V3 window op
// surface. Once installed:
//
//   window.__studioRBDFracture({meshUuid, sites, seed})  → { ok, setKey, chunkCount }
//   window.__studioRBDStep({setKey, dt})                 → { ok, restingCount }
//   window.__studioRBDExplode({setKey, impulseScale})    → { ok, awakeCount }
//   window.__studioRBDList()                              → { ok, sets:[…] }
//   window.__studioRBDClear({setKey})                     → { ok, removed }
//
// Each fracture creates a "set" — a logical group of chunk meshes plus
// the shared sim state. The source mesh is hidden (still in the scene
// for round-trip Undo); the chunks are added as siblings rooted at the
// source mesh's parent so the destruction reads in-place. Each chunk
// mesh is tagged with userData.archdiscStudioRBDChunk = setKey so the
// outliner / select-tools can group-select them.
//
// Pure JS, no external dependencies.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
import { voronoiFracture } from './fracture.js';
import {
  initChunkBodies, simulateChunks, applyExplodeImpulse,
} from './rbdSim.js';

const CHUNK_TAG = 'archdiscStudioRBDChunk';

// All active sets keyed by setKey.
//   { setKey, sourceUuid, chunks:[{ mesh, centroid:Vector3, bbox:Box3,
//                                    vel:[…], restitution, …}], gravity }
const _sets = new Map();
let _installed = false;
let _seq = 1;

function _getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function _findMesh(uuid) {
  const scene = _getScene();
  if (!scene) return null;
  return scene.getObjectByProperty('uuid', uuid) || null;
}

function _nextSetKey() {
  return `rbdset-${_seq++}-${Date.now().toString(36)}`;
}

// ── __studioRBDFracture ──────────────────────────────────────────────
function rbdFracture(opts) {
  const o = opts || {};
  const scene = _getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  const sourceUuid = o.meshUuid || (typeof window !== 'undefined' && window.__studioSelectedMesh
    && (window.__studioSelectedMesh() || {}).uuid);
  if (!sourceUuid) return { ok: false, error: 'no source mesh' };
  const source = _findMesh(sourceUuid);
  if (!source || !source.geometry) return { ok: false, error: 'mesh not found' };

  const sites = Math.max(2, Math.floor(Number(o.sites) || 8));
  const seed = Number(o.seed) || 1337;

  // Clone the source geometry so the fracture is operating on a fresh
  // axis-aligned copy in the source's local frame. We then apply the
  // source mesh's world matrix to chunk positions so the chunks land
  // where the original mesh was rendered.
  const srcGeom = source.geometry.clone();
  // Bake the source's scale into the geometry so the fracture lives in
  // world units; the position/rotation we'll re-apply on the parent.
  srcGeom.applyMatrix4(new THREE.Matrix4().compose(
    new THREE.Vector3(0, 0, 0),
    source.quaternion.clone(),
    source.scale.clone(),
  ));

  const fractured = voronoiFracture(srcGeom, sites, seed);
  if (!fractured || fractured.length === 0) {
    return { ok: false, error: 'fracture produced no chunks' };
  }

  // Build chunk meshes and add them to the scene. Centroid is stored in
  // local space; we shift the chunk geometry so its centroid lands at
  // the origin, then position the mesh at sourceWorldPos + centroid so
  // gravity / explode impulses act on the physical centre of mass.
  const setKey = _nextSetKey();
  const parent = source.parent || scene;
  const sourceWorld = source.position.clone(); // local pos already in parent space
  const chunks = [];

  // Reuse the source material when possible; otherwise default standard.
  const baseMat = source.material || new THREE.MeshStandardMaterial({
    color: 0x9bb0c1, roughness: 0.8, metalness: 0.05,
  });

  for (const { geometry, centroid } of fractured) {
    // Shift geometry so centroid sits at origin.
    geometry.translate(-centroid.x, -centroid.y, -centroid.z);
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    const mat = Array.isArray(baseMat) ? baseMat[0] : baseMat;
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.position.copy(sourceWorld).add(centroid);
    mesh.userData[CHUNK_TAG] = setKey;
    mesh.userData.archdiscStudioPrimitive = true;
    mesh.userData.archdiscStudioPrimitiveKind = 'rbd-chunk';
    parent.add(mesh);

    chunks.push({
      mesh,
      centroid: centroid.clone(),       // chunk-local centroid (always 0,0,0 after the translate above, but kept for impulse math)
      bbox: geometry.boundingBox.clone(),
    });
  }

  initChunkBodies(chunks, {
    restitution: o.restitution != null ? Number(o.restitution) : 0.4,
    friction:    o.friction    != null ? Number(o.friction)    : 0.85,
  });

  // Hide the source mesh; round-trip restorable on __studioRBDClear.
  source.visible = false;
  source.userData.__archdiscRBDHiddenBy = setKey;

  _sets.set(setKey, {
    setKey,
    sourceUuid,
    chunks,
    gravity: o.gravity || [0, -9.81, 0],
    iterations: o.iterations || 2,
    groundY: o.groundY != null ? Number(o.groundY) : 0,
  });

  return { ok: true, setKey, chunkCount: chunks.length };
}

// ── __studioRBDStep ──────────────────────────────────────────────────
function rbdStep(opts) {
  const o = opts || {};
  const setKey = o.setKey;
  const dt = Number(o.dt) || 1 / 60;
  if (!setKey || !_sets.has(setKey)) {
    return { ok: false, error: 'unknown setKey' };
  }
  const set = _sets.get(setKey);
  return simulateChunks(set.chunks, dt, set.gravity, set.iterations, set.groundY);
}

// ── __studioRBDExplode ───────────────────────────────────────────────
// Apply an outward radial impulse from the set's geometric centre of
// mass (mean of chunk world centroids).
function rbdExplode(opts) {
  const o = opts || {};
  const setKey = o.setKey;
  const k = Number(o.impulseScale) || 5;
  if (!setKey || !_sets.has(setKey)) {
    return { ok: false, error: 'unknown setKey' };
  }
  const set = _sets.get(setKey);
  const origin = new THREE.Vector3();
  for (const ch of set.chunks) {
    origin.x += (ch.mesh ? ch.mesh.position.x : 0);
    origin.y += (ch.mesh ? ch.mesh.position.y : 0);
    origin.z += (ch.mesh ? ch.mesh.position.z : 0);
  }
  origin.divideScalar(Math.max(1, set.chunks.length));
  return applyExplodeImpulse(set.chunks, origin, k);
}

// ── __studioRBDList ──────────────────────────────────────────────────
function rbdList() {
  const sets = [];
  for (const [k, s] of _sets.entries()) {
    sets.push({
      setKey: k,
      sourceUuid: s.sourceUuid,
      chunkCount: s.chunks.length,
      asleep: s.chunks.filter((c) => c.asleep).length,
    });
  }
  return { ok: true, sets };
}

// ── __studioRBDClear ─────────────────────────────────────────────────
function rbdClear(opts) {
  const o = opts || {};
  const setKey = o.setKey;
  if (!setKey || !_sets.has(setKey)) {
    return { ok: false, error: 'unknown setKey' };
  }
  const set = _sets.get(setKey);
  let removed = 0;
  for (const ch of set.chunks) {
    const m = ch.mesh;
    if (m && m.parent) {
      m.parent.remove(m);
      try { m.geometry && m.geometry.dispose && m.geometry.dispose(); } catch (_) {}
      removed++;
    }
  }
  // Restore source visibility.
  const source = _findMesh(set.sourceUuid);
  if (source && source.userData.__archdiscRBDHiddenBy === setKey) {
    source.visible = true;
    delete source.userData.__archdiscRBDHiddenBy;
  }
  _sets.delete(setKey);
  return { ok: true, removed };
}

export function installRBDDestruct() {
  if (_installed) return { ok: true, alreadyInstalled: true };
  _installed = true;
  const ops = {
    __studioRBDFracture: [rbdFracture,
      'Voronoi-fracture a mesh into rigid chunks (Houdini RBD destruct).'],
    __studioRBDStep:     [rbdStep,
      'Step one set of fracture chunks via semi-implicit Euler RBD sim.'],
    __studioRBDExplode:  [rbdExplode,
      'Apply outward radial impulse to every chunk in a set.'],
    __studioRBDList:     [rbdList,
      'List every active RBD destruction set.'],
    __studioRBDClear:    [rbdClear,
      'Remove a fracture set, restore the source mesh.'],
  };
  registerOps(ops, 'sim',
    'Houdini RBD destruction — Voronoi fracture + rigid body sim.');
  return { ok: true };
}

// Test-only helpers (exported for unit-level inspection).
export const __internals = { _sets, voronoiFracture };
