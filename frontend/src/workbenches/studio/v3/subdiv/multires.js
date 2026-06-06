// Slice 733 — Multi-resolution sculpting levels (ZBrush SubDiv / HD
// Geometry, Mudbox subdivision levels, Blender Multires modifier).
//
// A multires stack lets an artist sculpt broad form at a LOW subdivision
// level and fine detail at a HIGH level, then freely step DOWN to adjust
// the low-frequency shape WITHOUT destroying the high-frequency detail
// stored at the finer levels. This is the core of production sculpting
// (you don't sculpt a whole dragon at 20M polys — you block it out at
// level 1, then subdivide and add detail level by level).
//
// Model used here (the standard multires-displacement scheme):
//   • level 0 = the base cage (the mesh you start with).
//   • subdivideUp() Loop-subdivides the CURRENT top level into a new,
//     finer level and records, for that new level, the SUBDIVISION
//     PREDICTION (smooth-subdivided base) plus a per-vertex DETAIL
//     vector = actualPosition − prediction. On a fresh subdivision the
//     detail is zero.
//   • setLevel(L) rebuilds the displayed geometry by re-subdividing from
//     level 0 up to L, re-adding each level's stored detail at each step.
//     So edits made low DOWN propagate upward (the base moved → every
//     finer prediction moves with it) while each finer level's detail
//     RIDES ALONG on top — exactly the ZBrush behaviour.
//   • bake() captures the CURRENT displayed positions back into the
//     active level's detail (called after a sculpt stroke at that level).
//
// Detail is stored in the LOCAL frame would be ideal (tangent-space) but
// we use object-space displacement here — honest scope: detail is
// preserved exactly when lower levels translate/inflate smoothly; large
// low-level rotations can shear object-space detail. Tangent-space
// detail is the next refinement.
//
// Pure JS + three; eval-free; deterministic.

import * as THREE from 'three';
import { loopSubdivide } from './loopSubdiv.js';

// Per-mesh multires stack, keyed by mesh uuid.
const _stacks = new Map();

function getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}

function activeMesh() {
  if (typeof window === 'undefined') return null;
  if (typeof window.__studioSelectedMesh === 'function') {
    try { const m = window.__studioSelectedMesh(); if (m && m.isMesh && m.geometry) return m; } catch (_) {}
  }
  return null;
}

function meshByUuid(uuid) {
  const scene = getScene();
  if (!scene) return null;
  let m = null;
  scene.traverse((o) => { if (o.uuid === uuid && o.isMesh) m = o; });
  return m;
}

function posArray(geom) {
  const p = geom.attributes.position;
  return Float32Array.from(p.array);
}
function idxArray(geom) {
  if (geom.index) return Uint32Array.from(geom.index.array);
  // Non-indexed: synthesize a trivial index.
  const n = geom.attributes.position.count;
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  return idx;
}

// Build a stack rooted at the mesh's current geometry as level 0.
function ensureStack(mesh) {
  let s = _stacks.get(mesh.uuid);
  if (s) return s;
  const g = mesh.geometry;
  const base = {
    positions: posArray(g),
    indices: idxArray(g),
  };
  s = {
    uuid: mesh.uuid,
    levels: [base],          // levels[0] = base cage
    detail: [null],          // detail[L] = Float32 displacement at level L (null at base)
    current: 0,
  };
  _stacks.set(mesh.uuid, s);
  return s;
}

// Re-derive the displayed geometry for level L by subdividing from the
// base, re-adding each level's stored detail. Returns { positions, indices }.
function composite(s, L) {
  let positions = Float32Array.from(s.levels[0].positions);
  let indices = s.levels[0].indices;
  for (let lvl = 1; lvl <= L; lvl++) {
    const sub = loopSubdivide(positions, indices, { levels: 1 });
    positions = Float32Array.from(sub.positions);
    indices = sub.indices;
    const det = s.detail[lvl];
    if (det && det.length === positions.length) {
      for (let i = 0; i < positions.length; i++) positions[i] += det[i];
    }
  }
  return { positions, indices };
}

function applyToMesh(mesh, positions, indices) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(new THREE.BufferAttribute(indices, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const old = mesh.geometry;
  mesh.geometry = g;
  if (old && old.dispose) old.dispose();
}

// ── Public ops ──────────────────────────────────────────────────────

export function multiresInit(uuid) {
  const mesh = uuid ? meshByUuid(uuid) : activeMesh();
  if (!mesh) return { ok: false, error: 'no active mesh' };
  const s = ensureStack(mesh);
  return {
    ok: true, uuid: mesh.uuid, levels: s.levels.length, current: s.current,
    baseVerts: s.levels[0].positions.length / 3,
  };
}

// Subdivide the CURRENT top level into a new finer level and switch to it.
export function multiresSubdivide(uuid) {
  const mesh = uuid ? meshByUuid(uuid) : activeMesh();
  if (!mesh) return { ok: false, error: 'no active mesh' };
  const s = ensureStack(mesh);
  // Only allowed to add a level from the current TOP (no branching).
  if (s.current !== s.levels.length - 1) {
    // Step up to top first by recompositing — keep it simple: require top.
    return { ok: false, error: 'step to the top level before subdividing' };
  }
  if (typeof window !== 'undefined' && window.__studioPushUndo) window.__studioPushUndo();
  const top = s.levels[s.current];
  const sub = loopSubdivide(Float32Array.from(top.positions), top.indices, { levels: 1 });
  const newPositions = Float32Array.from(sub.positions);
  s.levels.push({ positions: newPositions, indices: sub.indices });
  s.detail.push(new Float32Array(newPositions.length)); // zero detail initially
  s.current = s.levels.length - 1;
  applyToMesh(mesh, Float32Array.from(newPositions), sub.indices);
  return {
    ok: true, uuid: mesh.uuid, level: s.current, levels: s.levels.length,
    verts: newPositions.length / 3,
  };
}

// Switch the displayed geometry to level L (rebuilds from base + detail).
export function multiresSetLevel(uuid, L) {
  const mesh = uuid ? meshByUuid(uuid) : activeMesh();
  if (!mesh) return { ok: false, error: 'no active mesh' };
  const s = _stacks.get(mesh.uuid);
  if (!s) return { ok: false, error: 'no multires stack — init first' };
  const lvl = Math.max(0, Math.min(s.levels.length - 1, Math.floor(L)));
  const { positions, indices } = composite(s, lvl);
  // Cache the recomposited positions as this level's authoritative geometry
  // so a later bake compares against the right reference.
  s.levels[lvl] = s.levels[lvl] || {};
  s.current = lvl;
  applyToMesh(mesh, positions, indices);
  return { ok: true, uuid: mesh.uuid, level: lvl, verts: positions.length / 3 };
}

// Capture the current displayed positions into the active level's detail.
// Called after a sculpt stroke so the edit is stored at the right level.
//   • At level 0 the edit updates the BASE positions directly (it is the
//     low-frequency form; finer predictions will follow it).
//   • At level L>0 the edit is stored as detail = current − prediction,
//     where prediction = subdivide(level 0..L) WITHOUT this level's detail.
export function multiresBake(uuid) {
  const mesh = uuid ? meshByUuid(uuid) : activeMesh();
  if (!mesh) return { ok: false, error: 'no active mesh' };
  const s = _stacks.get(mesh.uuid);
  if (!s) return { ok: false, error: 'no multires stack' };
  const L = s.current;
  const cur = posArray(mesh.geometry);
  if (L === 0) {
    if (cur.length !== s.levels[0].positions.length) {
      return { ok: false, error: 'vertex count changed at base — re-init' };
    }
    s.levels[0].positions = cur;
    return { ok: true, level: 0, stored: 'base' };
  }
  // Prediction = composite up to L with this level's detail zeroed.
  const savedDetail = s.detail[L];
  s.detail[L] = new Float32Array(cur.length);
  const pred = composite(s, L).positions;
  s.detail[L] = savedDetail || new Float32Array(cur.length);
  if (cur.length !== pred.length) {
    s.detail[L] = savedDetail;
    return { ok: false, error: 'vertex count mismatch at level' };
  }
  const det = new Float32Array(cur.length);
  let maxDisp = 0;
  for (let i = 0; i < cur.length; i++) {
    det[i] = cur[i] - pred[i];
    const a = Math.abs(det[i]); if (a > maxDisp) maxDisp = a;
  }
  s.detail[L] = det;
  return { ok: true, level: L, stored: 'detail', maxDisplacement: maxDisp };
}

export function multiresStats(uuid) {
  const mesh = uuid ? meshByUuid(uuid) : activeMesh();
  if (!mesh) return { ok: false, error: 'no active mesh' };
  const s = _stacks.get(mesh.uuid);
  if (!s) return { ok: false, error: 'no multires stack' };
  const levelVerts = s.levels.map((_, i) => composite(s, i).positions.length / 3);
  const detailMag = s.detail.map((d) => {
    if (!d) return 0;
    let m = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > m) m = a; }
    return m;
  });
  return {
    ok: true, uuid: mesh.uuid, levels: s.levels.length, current: s.current,
    levelVerts, detailMag,
  };
}

export function multiresDelete(uuid) {
  const mesh = uuid ? meshByUuid(uuid) : activeMesh();
  if (!mesh) return { ok: false };
  return { ok: _stacks.delete(mesh.uuid) };
}
