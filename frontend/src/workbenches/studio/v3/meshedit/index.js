// ArchDisc Studio V3 — Maya MultiCut + Bridge Edges + Bevel Edges trio
// (slice 756).
//
// installMeshEdit() registers five `__studioMesh*` ops on the window +
// command palette, each operating on the active scene mesh's
// THREE.BufferGeometry via real per-vertex / per-face surgery:
//
//   __studioMeshBridge(meshUuid, loopA, loopB)
//     Stitch a quad strip between two parallel border edge loops.
//   __studioMeshMultiCut(meshUuid, startIdx, endIdx, segments)
//     Insert a straight chain of new verts between two existing verts;
//     split any triangle the cut line crosses (Maya MultiCut).
//   __studioMeshBevelEdges(meshUuid, edgePairs[], width)
//     Replace each marked edge with two parallel edges offset by `width`
//     and fill the gap with a strip of quads.
//   __studioMeshExtrudeEdge(meshUuid, edgeIdx, distance, axis)
//     Extrude a triangle's first edge (vert0→vert1) along an axis by
//     `distance`, emitting two duplicated verts + a connecting quad.
//   __studioMeshDeleteFace(meshUuid, faceIdx)
//     Remove triangle faceIdx (no vertex compaction; the verts stay,
//     which mirrors Maya's behaviour where the face is dropped but
//     dangling verts persist until a Clean op runs).
//
// The mesh-resolver supports either an explicit UUID or falls back to
// `window.__studioSelectedMesh()`. Geometry is rebuilt in place; the
// existing geometry is disposed first.

import * as THREE from 'three';

import { registerOps } from '../common/registry.js';
import { bridgeEdges } from './bridgeEdges.js';
import { multiCut } from './multiCut.js';
import { bevelEdges } from './bevelEdges.js';

let _installed = false;

function _resolveMesh(uuid) {
  if (typeof window === 'undefined') return null;
  const scene = window.__archdiscScene;
  if (uuid && scene && typeof scene.getObjectByProperty === 'function') {
    const m = scene.getObjectByProperty('uuid', uuid);
    if (m) return m;
  }
  if (typeof window.__studioSelectedMesh === 'function') {
    try { return window.__studioSelectedMesh() || null; } catch (_) { /* ignore */ }
  }
  return null;
}

function _swapGeometry(mesh, newGeom) {
  if (mesh.geometry) {
    try {
      if (mesh.geometry.boundsTree && typeof mesh.geometry.disposeBoundsTree === 'function') {
        mesh.geometry.disposeBoundsTree();
      }
    } catch (_) { /* ignore */ }
    try { mesh.geometry.dispose(); } catch (_) { /* ignore */ }
  }
  mesh.geometry = newGeom;
}

function _pushUndo() {
  if (typeof window !== 'undefined' && typeof window.__studioPushUndo === 'function') {
    try { window.__studioPushUndo(); } catch (_) { /* ignore */ }
  }
}

// ─── 1. Bridge ─────────────────────────────────────────────────────────
function opBridge(meshUuid, loopA, loopB, opts) {
  const mesh = _resolveMesh(meshUuid);
  if (!mesh) return { ok: false, error: 'no mesh' };
  if (!mesh.geometry) return { ok: false, error: 'mesh has no geometry' };
  _pushUndo();
  const r = bridgeEdges(mesh.geometry, loopA, loopB, opts);
  if (!r.ok) return r;
  _swapGeometry(mesh, r.geometry);
  return { ok: true, addedFaces: r.addedFaces, addedQuads: r.addedQuads, closed: r.closed, flipped: r.flipped };
}

// ─── 2. MultiCut ──────────────────────────────────────────────────────
function opMultiCut(meshUuid, startIdx, endIdx, segments) {
  const mesh = _resolveMesh(meshUuid);
  if (!mesh) return { ok: false, error: 'no mesh' };
  if (!mesh.geometry) return { ok: false, error: 'mesh has no geometry' };
  _pushUndo();
  const r = multiCut(mesh.geometry, startIdx | 0, endIdx | 0, segments);
  if (!r.ok) return r;
  _swapGeometry(mesh, r.geometry);
  return { ok: true, addedVerts: r.addedVerts, addedFaces: r.addedFaces, vertChain: r.vertChain };
}

// ─── 3. Bevel edges ───────────────────────────────────────────────────
// Slice 961 — opts.cornerResolution (default true): where ≥2 beveled
// edges meet, the corner hole is boundary-traced and fan-filled
// (Maya corner-bevel fillet). Pass { cornerResolution: false } for the
// legacy per-edge behaviour.
function opBevelEdges(meshUuid, edgePairs, width, opts) {
  const mesh = _resolveMesh(meshUuid);
  if (!mesh) return { ok: false, error: 'no mesh' };
  if (!mesh.geometry) return { ok: false, error: 'mesh has no geometry' };
  _pushUndo();
  const r = bevelEdges(mesh.geometry, edgePairs, width, opts || {});
  if (!r.ok) return r;
  _swapGeometry(mesh, r.geometry);
  return { ok: true, addedFaces: r.addedFaces, beveled: r.beveled,
           cornerFaces: r.cornerFaces || 0, skipped: r.skipped, errors: r.errors };
}

// ─── 4. Extrude edge ─────────────────────────────────────────────────
// Take triangle `edgeIdx` and extrude its first edge (vert0 → vert1)
// along the given axis by `distance`. Two new verts are added at the
// edge endpoints + axis*distance, and a connecting quad (two CCW tris)
// is appended. The original tri is unchanged.
function opExtrudeEdge(meshUuid, edgeIdx, distance, axis) {
  const mesh = _resolveMesh(meshUuid);
  if (!mesh) return { ok: false, error: 'no mesh' };
  if (!mesh.geometry) return { ok: false, error: 'mesh has no geometry' };
  const geom = mesh.geometry;
  const posAttr = geom.attributes.position;
  if (!posAttr) return { ok: false, error: 'no positions' };
  let idxAttr = geom.index;
  if (!idxAttr) {
    // Synthesize an index so we can locate triangles by index.
    const tmp = new Uint32Array(posAttr.count);
    for (let i = 0; i < posAttr.count; i++) tmp[i] = i;
    geom.setIndex(new THREE.BufferAttribute(tmp, 1));
    idxAttr = geom.index;
  }
  const triCount = idxAttr.count / 3;
  const fi = edgeIdx | 0;
  if (fi < 0 || fi >= triCount) return { ok: false, error: 'edgeIdx out of range' };

  const d = Number(distance);
  if (!Number.isFinite(d) || d === 0) return { ok: false, error: 'distance must be non-zero' };

  // Resolve axis to a unit Vector3.
  let ax = 0, ay = 1, az = 0;
  if (Array.isArray(axis) && axis.length >= 3) {
    ax = Number(axis[0]) || 0; ay = Number(axis[1]) || 0; az = Number(axis[2]) || 0;
  } else if (typeof axis === 'string') {
    switch (axis.toLowerCase()) {
      case 'x': ax = 1; ay = 0; az = 0; break;
      case 'y': ax = 0; ay = 1; az = 0; break;
      case 'z': ax = 0; ay = 0; az = 1; break;
      case '-x': ax = -1; ay = 0; az = 0; break;
      case '-y': ax = 0; ay = -1; az = 0; break;
      case '-z': ax = 0; ay = 0; az = -1; break;
      default: break;
    }
  }
  const L = Math.hypot(ax, ay, az);
  if (L < 1e-12) return { ok: false, error: 'axis has zero length' };
  ax /= L; ay /= L; az /= L;

  _pushUndo();

  // Copy buffers.
  const verts = [];
  for (let i = 0; i < posAttr.count; i++) {
    verts.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
  }
  const idx = new Array(idxAttr.count);
  for (let i = 0; i < idxAttr.count; i++) idx[i] = idxAttr.getX(i);

  const v0 = idx[fi * 3], v1 = idx[fi * 3 + 1];
  // New vert at v0 + axis*d.
  const n0 = verts.length / 3;
  verts.push(
    verts[v0 * 3]     + ax * d,
    verts[v0 * 3 + 1] + ay * d,
    verts[v0 * 3 + 2] + az * d,
  );
  // New vert at v1 + axis*d.
  const n1 = verts.length / 3;
  verts.push(
    verts[v1 * 3]     + ax * d,
    verts[v1 * 3 + 1] + ay * d,
    verts[v1 * 3 + 2] + az * d,
  );
  // Quad (v0, v1, n1, n0) — two CCW tris.
  idx.push(v0, v1, n1);
  idx.push(v0, n1, n0);

  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const IdxCtor = idx.length > 65535
    ? THREE.Uint32BufferAttribute
    : THREE.Uint16BufferAttribute;
  newGeom.setIndex(new IdxCtor(idx, 1));
  newGeom.computeVertexNormals();
  newGeom.computeBoundingBox();
  newGeom.computeBoundingSphere();
  _swapGeometry(mesh, newGeom);

  return { ok: true, addedFaces: 2, newVerts: [n0, n1] };
}

// ─── 5. Delete face ──────────────────────────────────────────────────
function opDeleteFace(meshUuid, faceIdx) {
  const mesh = _resolveMesh(meshUuid);
  if (!mesh) return { ok: false, error: 'no mesh' };
  if (!mesh.geometry) return { ok: false, error: 'mesh has no geometry' };
  const geom = mesh.geometry;
  const posAttr = geom.attributes.position;
  if (!posAttr) return { ok: false, error: 'no positions' };
  let idxAttr = geom.index;
  if (!idxAttr) {
    const tmp = new Uint32Array(posAttr.count);
    for (let i = 0; i < posAttr.count; i++) tmp[i] = i;
    geom.setIndex(new THREE.BufferAttribute(tmp, 1));
    idxAttr = geom.index;
  }
  const triCount = idxAttr.count / 3;
  const fi = faceIdx | 0;
  if (fi < 0 || fi >= triCount) return { ok: false, error: 'faceIdx out of range' };

  _pushUndo();

  const verts = [];
  for (let i = 0; i < posAttr.count; i++) {
    verts.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
  }
  const idx = [];
  for (let f = 0; f < triCount; f++) {
    if (f === fi) continue;
    idx.push(idxAttr.getX(f * 3), idxAttr.getX(f * 3 + 1), idxAttr.getX(f * 3 + 2));
  }
  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const IdxCtor = idx.length > 65535
    ? THREE.Uint32BufferAttribute
    : THREE.Uint16BufferAttribute;
  newGeom.setIndex(new IdxCtor(idx, 1));
  newGeom.computeVertexNormals();
  newGeom.computeBoundingBox();
  newGeom.computeBoundingSphere();
  _swapGeometry(mesh, newGeom);
  return { ok: true, triBefore: triCount, triAfter: triCount - 1 };
}

// ─── Install / uninstall ─────────────────────────────────────────────
export function installMeshEdit() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, alreadyInstalled: true };
  _installed = true;

  const ops = {
    __studioMeshBridge: [
      (uuid, loopA, loopB, opts) => opBridge(uuid, loopA, loopB, opts),
      'Maya/Modo Bridge Edges — stitch a quad strip between two parallel border edge loops.',
    ],
    __studioMeshMultiCut: [
      (uuid, startIdx, endIdx, segments) => opMultiCut(uuid, startIdx, endIdx, segments),
      'Maya MultiCut — insert a chain of new verts along the line through two picks and split any triangle the line crosses.',
    ],
    __studioMeshBevelEdges: [
      (uuid, edgePairs, width, opts) => opBevelEdges(uuid, edgePairs, width, opts),
      'Maya/Modo Bevel Edges — replace each marked edge with two parallel edges offset by `width`, fill the gap with quads, and fan-fill chained corners (opts.cornerResolution, default true).',
    ],
    __studioMeshExtrudeEdge: [
      (uuid, edgeIdx, distance, axis) => opExtrudeEdge(uuid, edgeIdx, distance, axis),
      'Extrude a triangle\'s first edge along an axis by `distance`, emitting two duplicated verts + a connecting quad.',
    ],
    __studioMeshDeleteFace: [
      (uuid, faceIdx) => opDeleteFace(uuid, faceIdx),
      'Delete triangle `faceIdx` (Maya-style: dangling verts stay until a Clean op).',
    ],
  };

  registerOps(ops, 'mesh-edit');

  return { ok: true, alreadyInstalled: false, ops: Object.keys(ops).length };
}

export default installMeshEdit;
