// ArchDisc Studio V3 — edit-mode auxiliary family.
//
// Lower-level edit-mode building blocks not covered by editops:
//   __studioPickVertexAt        — nearest-vertex pick by world-space point
//   __studioMoveVertex          — translate a single vertex by world delta
//   __studioInsertVertexOnEdge  — split an edge by inserting its midpoint
//   __studioListEdges           — unique-edge enumeration with lengths
//   __studioPickEdge            — highlight an edge by index
//   __studioClearEdgeSelection  — drop the highlight
//   __studioMarkEdgeSeam        — toggle a seam marker on an edge
//   __studioListSeams           — list seam keys for a mesh
//   __studioClearSeams          — wipe seam markers
//   __studioPushFace            — translate a face's 3 verts along its normal

import * as THREE from 'three';

function scene() {
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}
function activeMesh() {
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}
function findMeshByUuid(meshUuid) {
  if (!meshUuid) return null;
  const s = scene(); if (!s) return null;
  let m = null;
  s.traverse((o) => { if (o.isMesh && o.uuid === meshUuid) m = o; });
  return m;
}

function listEdges(meshUuid) {
  const mesh = findMeshByUuid(meshUuid) || activeMesh();
  if (!mesh || !mesh.geometry) return [];
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  const idx = geom.index ? geom.index.array : null;
  const triCount = idx ? idx.length / 3 : pos.count / 3;
  const seen = new Map();
  for (let t = 0; t < triCount; t++) {
    const v = [0, 1, 2].map((k) => idx ? idx[t * 3 + k] : t * 3 + k);
    for (const [a, b] of [[v[0], v[1]], [v[1], v[2]], [v[2], v[0]]]) {
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const key = lo + ',' + hi;
      if (!seen.has(key)) seen.set(key, { idx: seen.size, fromVertIdx: lo, toVertIdx: hi });
    }
  }
  const out = [];
  for (const e of seen.values()) {
    const dx = pos.getX(e.toVertIdx) - pos.getX(e.fromVertIdx);
    const dy = pos.getY(e.toVertIdx) - pos.getY(e.fromVertIdx);
    const dz = pos.getZ(e.toVertIdx) - pos.getZ(e.fromVertIdx);
    out.push({ ...e, length: Math.hypot(dx, dy, dz) });
  }
  return out;
}

function pickVertexAt(worldPoint) {
  const m = activeMesh();
  if (!m || !m.geometry || !m.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  if (!Array.isArray(worldPoint) || worldPoint.length !== 3) return { ok: false, error: 'worldPoint must be [x,y,z]' };
  const t = new THREE.Vector3(worldPoint[0], worldPoint[1], worldPoint[2]);
  const pos = m.geometry.attributes.position;
  m.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let bestD = Infinity, bestIdx = -1;
  const bestW = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
    const d = v.distanceTo(t);
    if (d < bestD) { bestD = d; bestIdx = i; bestW.copy(v); }
  }
  return { ok: true, vertIdx: bestIdx, point: [bestW.x, bestW.y, bestW.z], distance: bestD };
}

function moveVertex(meshUuid, vertIdx, deltaWorld) {
  const m = findMeshByUuid(meshUuid) || activeMesh();
  if (!m || !m.geometry || !m.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  if (!Array.isArray(deltaWorld) || deltaWorld.length !== 3) return { ok: false, error: 'deltaWorld must be [x,y,z]' };
  const pos = m.geometry.attributes.position;
  const i = vertIdx | 0;
  if (i < 0 || i >= pos.count) return { ok: false, error: 'vertIdx out of range' };
  m.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(m.matrixWorld).invert();
  inv.elements[12] = 0; inv.elements[13] = 0; inv.elements[14] = 0;
  const dW = new THREE.Vector3(deltaWorld[0], deltaWorld[1], deltaWorld[2]);
  const dL = dW.clone().applyMatrix4(inv);
  pos.setXYZ(i, pos.getX(i) + dL.x, pos.getY(i) + dL.y, pos.getZ(i) + dL.z);
  pos.needsUpdate = true;
  m.geometry.computeVertexNormals();
  m.geometry.computeBoundingSphere();
  m.userData.archdiscStudioVertMoved = (m.userData.archdiscStudioVertMoved || 0) + 1;
  return { ok: true, vertIdx: i, deltaWorld, deltaLocal: [dL.x, dL.y, dL.z] };
}

function insertVertexOnEdge(meshUuid, edgeIdx) {
  const m = findMeshByUuid(meshUuid) || activeMesh();
  if (!m || !m.geometry || !m.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  if (m.geometry.index) {
    const flat = m.geometry.toNonIndexed();
    if (m.geometry.dispose) m.geometry.dispose();
    m.geometry = flat;
  }
  const edges = listEdges(m.uuid);
  const e = edges[edgeIdx | 0];
  if (!e) return { ok: false, error: 'edge idx out of range' };
  const pos = m.geometry.attributes.position;
  const a = e.fromVertIdx, b = e.toVertIdx;
  const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
  const bx = pos.getX(b), by = pos.getY(b), bz = pos.getZ(b);
  const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;
  const triCount = pos.count / 3;
  const newPositions = Array.from(pos.array);
  let splits = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = t * 3, i1 = t * 3 + 1, i2 = t * 3 + 2;
    const idxs = [i0, i1, i2];
    let posA = -1, posB = -1, posC = -1;
    for (const ix of idxs) {
      const vx = pos.getX(ix), vy = pos.getY(ix), vz = pos.getZ(ix);
      if (vx === ax && vy === ay && vz === az) posA = ix;
      else if (vx === bx && vy === by && vz === bz) posB = ix;
      else posC = ix;
    }
    if (posA < 0 || posB < 0 || posC < 0) continue;
    const cx = pos.getX(posC), cy = pos.getY(posC), cz = pos.getZ(posC);
    if (posB === i0) { newPositions[i0 * 3] = mx; newPositions[i0 * 3 + 1] = my; newPositions[i0 * 3 + 2] = mz; }
    else if (posB === i1) { newPositions[i1 * 3] = mx; newPositions[i1 * 3 + 1] = my; newPositions[i1 * 3 + 2] = mz; }
    else { newPositions[i2 * 3] = mx; newPositions[i2 * 3 + 1] = my; newPositions[i2 * 3 + 2] = mz; }
    newPositions.push(mx, my, mz, bx, by, bz, cx, cy, cz);
    splits++;
  }
  m.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(newPositions), 3));
  m.geometry.computeVertexNormals();
  m.geometry.computeBoundingSphere();
  m.geometry.computeBoundingBox();
  m.userData.archdiscStudioEdgeSplit = (m.userData.archdiscStudioEdgeSplit || 0) + splits;
  return { ok: true, splits, newVertCount: m.geometry.attributes.position.count };
}

function pickEdge(meshUuid, edgeIdx) {
  const mesh = findMeshByUuid(meshUuid) || activeMesh();
  if (!mesh || !mesh.geometry) return { ok: false, error: 'no mesh' };
  const edges = listEdges(mesh.uuid);
  const e = edges[edgeIdx | 0];
  if (!e) return { ok: false, error: 'edge idx out of range' };
  if (window.__studioPickedEdgeHelper) {
    const h = window.__studioPickedEdgeHelper;
    if (h.parent) h.parent.remove(h);
    if (h.geometry) h.geometry.dispose(); if (h.material) h.material.dispose();
  }
  const pos = mesh.geometry.attributes.position;
  const ax = pos.getX(e.fromVertIdx), ay = pos.getY(e.fromVertIdx), az = pos.getZ(e.fromVertIdx);
  const bx = pos.getX(e.toVertIdx),   by = pos.getY(e.toVertIdx),   bz = pos.getZ(e.toVertIdx);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([ax, ay, az, bx, by, bz], 3));
  const mat = new THREE.LineBasicMaterial({ color: 0xffff00, depthTest: false, transparent: true, opacity: 0.95 });
  const helper = new THREE.LineSegments(g, mat);
  helper.renderOrder = 999;
  helper.userData.archdiscPickedEdge = true;
  mesh.add(helper);
  window.__studioPickedEdgeHelper = helper;
  return { ok: true, idx: edgeIdx, from: [ax, ay, az], to: [bx, by, bz], length: e.length };
}

function clearEdgeSelection() {
  const h = window.__studioPickedEdgeHelper;
  if (!h) return { ok: true, cleared: false };
  if (h.parent) h.parent.remove(h);
  if (h.geometry) h.geometry.dispose(); if (h.material) h.material.dispose();
  window.__studioPickedEdgeHelper = null;
  return { ok: true, cleared: true };
}

function markEdgeSeam(meshUuid, edgeIdx, marked = true) {
  const mesh = findMeshByUuid(meshUuid) || activeMesh();
  if (!mesh || !mesh.geometry) return { ok: false, error: 'no mesh' };
  const edges = listEdges(mesh.uuid);
  const e = edges[edgeIdx | 0];
  if (!e) return { ok: false, error: 'edge idx out of range' };
  const key = Math.min(e.fromVertIdx, e.toVertIdx) + ',' + Math.max(e.fromVertIdx, e.toVertIdx);
  if (!mesh.userData.studioSeamEdges) mesh.userData.studioSeamEdges = new Set();
  if (marked) mesh.userData.studioSeamEdges.add(key);
  else mesh.userData.studioSeamEdges.delete(key);
  return { ok: true, key, marked, count: mesh.userData.studioSeamEdges.size };
}

function listSeams(meshUuid) {
  const mesh = findMeshByUuid(meshUuid) || activeMesh();
  if (!mesh || !mesh.userData || !mesh.userData.studioSeamEdges) return [];
  return Array.from(mesh.userData.studioSeamEdges);
}

function clearSeams(meshUuid) {
  const mesh = findMeshByUuid(meshUuid) || activeMesh();
  if (!mesh || !mesh.userData) return { ok: false };
  const had = mesh.userData.studioSeamEdges ? mesh.userData.studioSeamEdges.size : 0;
  if (mesh.userData.studioSeamEdges) mesh.userData.studioSeamEdges.clear();
  return { ok: true, cleared: had };
}

function pushFace(meshUuid, faceIndex, distance) {
  const mesh = findMeshByUuid(meshUuid) || activeMesh();
  if (!mesh || !mesh.geometry) return { ok: false, error: 'no mesh' };
  const geom = mesh.geometry;
  const pos = geom.attributes.position;
  const f = faceIndex | 0;
  let a, b, c;
  if (geom.index) {
    const idx = geom.index.array;
    if (f * 3 + 2 >= idx.length) return { ok: false, error: 'faceIndex out of range' };
    a = idx[f * 3]; b = idx[f * 3 + 1]; c = idx[f * 3 + 2];
  } else {
    if (f * 3 + 2 >= pos.count) return { ok: false, error: 'faceIndex out of range' };
    a = f * 3; b = f * 3 + 1; c = f * 3 + 2;
  }
  const vA = new THREE.Vector3().fromBufferAttribute(pos, a);
  const vB = new THREE.Vector3().fromBufferAttribute(pos, b);
  const vC = new THREE.Vector3().fromBufferAttribute(pos, c);
  const e1 = new THREE.Vector3().subVectors(vB, vA);
  const e2 = new THREE.Vector3().subVectors(vC, vA);
  const n  = new THREE.Vector3().crossVectors(e1, e2).normalize();
  const dx = n.x * distance, dy = n.y * distance, dz = n.z * distance;
  if (window.__studioPushUndo) window.__studioPushUndo();
  pos.setXYZ(a, vA.x + dx, vA.y + dy, vA.z + dz);
  pos.setXYZ(b, vB.x + dx, vB.y + dy, vB.z + dz);
  pos.setXYZ(c, vC.x + dx, vC.y + dy, vC.z + dz);
  pos.needsUpdate = true;
  geom.computeVertexNormals();
  geom.computeBoundingSphere();
  mesh.userData.archdiscStudioFacePushed = (mesh.userData.archdiscStudioFacePushed || 0) + 1;
  return { ok: true, meshUuid: mesh.uuid, faceIndex: f, distance, normal: [n.x, n.y, n.z] };
}

export function registerEditAuxOps() {
  window.__studioListEdges          = listEdges;
  window.__studioPickVertexAt       = pickVertexAt;
  window.__studioMoveVertex         = moveVertex;
  window.__studioInsertVertexOnEdge = insertVertexOnEdge;
  window.__studioPickEdge           = pickEdge;
  window.__studioClearEdgeSelection = clearEdgeSelection;
  window.__studioMarkEdgeSeam       = markEdgeSeam;
  window.__studioListSeams          = listSeams;
  window.__studioClearSeams         = clearSeams;
  window.__studioPushFace           = pushFace;
}

export function unregisterEditAuxOps() {
  for (const k of [
    '__studioListEdges', '__studioPickVertexAt', '__studioMoveVertex',
    '__studioInsertVertexOnEdge', '__studioPickEdge', '__studioClearEdgeSelection',
    '__studioMarkEdgeSeam', '__studioListSeams', '__studioClearSeams', '__studioPushFace',
  ]) { try { delete window[k]; } catch (_) {} }
}
