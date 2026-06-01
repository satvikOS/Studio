// ArchDisc Studio V3 — edit-mode operators.
//
// V3-native ports of V2 slices 373-390. Each op operates on the active
// mesh (window.__archdiscViewport.getSelected()) and/or on the slice-381
// multi-selection set held in window.__studioEditSelection.current.
//
// Conventions:
//   • All ops return { ok, ... }. Failures attach `error: <string>`.
//   • Geometry mutations push an undo snapshot before doing anything.
//   • Camera projections + raycasts honour three-mesh-bvh: build the
//     boundsTree on demand, use intersectObjects (plural) since the
//     accelerator patches that one.

import * as THREE from 'three';

function activeMesh() {
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}

function bvhBuildIfNeeded(geo) {
  if (geo && geo.computeBoundsTree && !geo.boundsTree) {
    try { geo.computeBoundsTree(); } catch (_) {}
  }
}

function syncCameraMatrices(cam) {
  cam.updateMatrixWorld(true);
  if (cam.matrixWorldInverse) cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
}

// ─── PICKERS (V2 slice 373/374/375) ──────────────────────────────────────
function pickVertexFromClick(ndcX, ndcY) {
  const vp = window.__archdiscViewport;
  const m = activeMesh();
  if (!vp || !vp.camera || !m || !m.geometry || !m.geometry.attributes.position) {
    return { ok: false, error: 'no mesh / no viewport' };
  }
  syncCameraMatrices(vp.camera);
  m.updateMatrixWorld(true);
  bvhBuildIfNeeded(m.geometry);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(ndcX, ndcY), vp.camera);
  rc.firstHitOnly = true;
  const hits = rc.intersectObjects([m], false);
  if (!hits.length) return { ok: false, error: 'no hit' };
  const hit = hits[0];
  const pos = m.geometry.attributes.position;
  const idx = m.geometry.index ? m.geometry.index.array : null;
  const f = hit.faceIndex == null ? 0 : hit.faceIndex;
  const a = idx ? idx[f * 3] : f * 3;
  const b = idx ? idx[f * 3 + 1] : f * 3 + 1;
  const c = idx ? idx[f * 3 + 2] : f * 3 + 2;
  const vA = new THREE.Vector3().fromBufferAttribute(pos, a).applyMatrix4(m.matrixWorld);
  const vB = new THREE.Vector3().fromBufferAttribute(pos, b).applyMatrix4(m.matrixWorld);
  const vC = new THREE.Vector3().fromBufferAttribute(pos, c).applyMatrix4(m.matrixWorld);
  const dA = vA.distanceTo(hit.point);
  const dB = vB.distanceTo(hit.point);
  const dC = vC.distanceTo(hit.point);
  let pickIdx = a, pickWorld = vA, pickDist = dA;
  if (dB < pickDist) { pickIdx = b; pickWorld = vB; pickDist = dB; }
  if (dC < pickDist) { pickIdx = c; pickWorld = vC; pickDist = dC; }
  return {
    ok: true, vertIdx: pickIdx, faceIdx: f,
    point: [pickWorld.x, pickWorld.y, pickWorld.z],
    distance: pickDist,
  };
}

function pickFaceFromClick(ndcX, ndcY) {
  const vp = window.__archdiscViewport;
  const m = activeMesh();
  if (!vp || !vp.camera || !m || !m.geometry || !m.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  syncCameraMatrices(vp.camera);
  m.updateMatrixWorld(true);
  bvhBuildIfNeeded(m.geometry);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(ndcX, ndcY), vp.camera);
  rc.firstHitOnly = true;
  const hits = rc.intersectObjects([m], false);
  if (!hits.length) return { ok: false, error: 'no hit' };
  const hit = hits[0];
  const pos = m.geometry.attributes.position;
  const idx = m.geometry.index ? m.geometry.index.array : null;
  const f = hit.faceIndex == null ? 0 : hit.faceIndex;
  const a = idx ? idx[f * 3] : f * 3;
  const b = idx ? idx[f * 3 + 1] : f * 3 + 1;
  const c = idx ? idx[f * 3 + 2] : f * 3 + 2;
  const vA = new THREE.Vector3().fromBufferAttribute(pos, a).applyMatrix4(m.matrixWorld);
  const vB = new THREE.Vector3().fromBufferAttribute(pos, b).applyMatrix4(m.matrixWorld);
  const vC = new THREE.Vector3().fromBufferAttribute(pos, c).applyMatrix4(m.matrixWorld);
  const cx = (vA.x + vB.x + vC.x) / 3;
  const cy = (vA.y + vB.y + vC.y) / 3;
  const cz = (vA.z + vB.z + vC.z) / 3;
  const n = new THREE.Vector3().subVectors(vB, vA).cross(new THREE.Vector3().subVectors(vC, vA)).normalize();
  return {
    ok: true, faceIdx: f, vertIdx: [a, b, c],
    centroid: [cx, cy, cz],
    normal: [n.x, n.y, n.z],
    hitPoint: [hit.point.x, hit.point.y, hit.point.z],
    distance: hit.distance,
  };
}

function pickEdgeFromClick(ndcX, ndcY) {
  const vp = window.__archdiscViewport;
  const m = activeMesh();
  if (!vp || !vp.camera || !m || !m.geometry || !m.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  syncCameraMatrices(vp.camera);
  m.updateMatrixWorld(true);
  bvhBuildIfNeeded(m.geometry);
  const rc = new THREE.Raycaster();
  rc.setFromCamera(new THREE.Vector2(ndcX, ndcY), vp.camera);
  rc.firstHitOnly = true;
  const hits = rc.intersectObjects([m], false);
  if (!hits.length) return { ok: false, error: 'no hit' };
  const hit = hits[0];
  const pos = m.geometry.attributes.position;
  const idx = m.geometry.index ? m.geometry.index.array : null;
  const f = hit.faceIndex == null ? 0 : hit.faceIndex;
  const ia = idx ? idx[f * 3] : f * 3;
  const ib = idx ? idx[f * 3 + 1] : f * 3 + 1;
  const ic = idx ? idx[f * 3 + 2] : f * 3 + 2;
  const vA = new THREE.Vector3().fromBufferAttribute(pos, ia).applyMatrix4(m.matrixWorld);
  const vB = new THREE.Vector3().fromBufferAttribute(pos, ib).applyMatrix4(m.matrixWorld);
  const vC = new THREE.Vector3().fromBufferAttribute(pos, ic).applyMatrix4(m.matrixWorld);
  const distToSegment = (p, a, b) => {
    const ab = new THREE.Vector3().subVectors(b, a);
    const ap = new THREE.Vector3().subVectors(p, a);
    const t = Math.max(0, Math.min(1, ap.dot(ab) / ab.lengthSq()));
    const closest = a.clone().addScaledVector(ab, t);
    return { d: closest.distanceTo(p), point: closest };
  };
  const edges = [
    { v0: ia, v1: ib, info: distToSegment(hit.point, vA, vB), p0: vA, p1: vB },
    { v0: ib, v1: ic, info: distToSegment(hit.point, vB, vC), p0: vB, p1: vC },
    { v0: ic, v1: ia, info: distToSegment(hit.point, vC, vA), p0: vC, p1: vA },
  ];
  edges.sort((a, b) => a.info.d - b.info.d);
  const e = edges[0];
  const mid = new THREE.Vector3().addVectors(e.p0, e.p1).multiplyScalar(0.5);
  return {
    ok: true, faceIdx: f, vertIdx: [e.v0, e.v1],
    midpoint: [mid.x, mid.y, mid.z],
    closestPoint: [e.info.point.x, e.info.point.y, e.info.point.z],
    distance: e.info.d,
    length: e.p0.distanceTo(e.p1),
  };
}

// ─── Selection helpers ───────────────────────────────────────────────────
function touchedVerts() {
  const m = activeMesh();
  if (!m) return { mesh: null, touched: new Set() };
  const sel = window.__studioEditSelection.current;
  const idx = m.geometry.index ? m.geometry.index.array : null;
  const touched = new Set();
  for (const v of sel.vertices) touched.add(v);
  for (const e of sel.edges) { touched.add(e[0]); touched.add(e[1]); }
  for (const f of sel.faces) {
    const a = idx ? idx[f * 3] : f * 3;
    const b = idx ? idx[f * 3 + 1] : f * 3 + 1;
    const c = idx ? idx[f * 3 + 2] : f * 3 + 2;
    touched.add(a); touched.add(b); touched.add(c);
  }
  return { mesh: m, touched };
}

// ─── G/R/S (V2 slices 382/384/385) ───────────────────────────────────────
function moveSelectedVerts(dx, dy, dz) {
  const { mesh, touched } = touchedVerts();
  if (!mesh) return { ok: false, error: 'no mesh' };
  if (!touched.size) return { ok: false, error: 'empty selection' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  mesh.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const worldZero = new THREE.Vector3(0, 0, 0).applyMatrix4(inv);
  const localDelta = new THREE.Vector3(dx, dy, dz).applyMatrix4(inv).sub(worldZero);
  const pos = mesh.geometry.attributes.position;
  for (const v of touched) {
    pos.setXYZ(v, pos.getX(v) + localDelta.x, pos.getY(v) + localDelta.y, pos.getZ(v) + localDelta.z);
  }
  pos.needsUpdate = true;
  if (mesh.geometry.computeVertexNormals) mesh.geometry.computeVertexNormals();
  if (mesh.geometry.boundsTree && mesh.geometry.disposeBoundsTree) mesh.geometry.disposeBoundsTree();
  return { ok: true, vertCount: touched.size, deltaWorld: [dx, dy, dz] };
}

function scaleSelectedVerts(factor) {
  const { mesh, touched } = touchedVerts();
  if (!mesh) return { ok: false, error: 'no mesh' };
  if (typeof factor !== 'number' || !Number.isFinite(factor)) return { ok: false, error: 'bad factor' };
  if (!touched.size) return { ok: false, error: 'empty selection' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  const pos = mesh.geometry.attributes.position;
  let cx = 0, cy = 0, cz = 0;
  for (const v of touched) { cx += pos.getX(v); cy += pos.getY(v); cz += pos.getZ(v); }
  cx /= touched.size; cy /= touched.size; cz /= touched.size;
  for (const v of touched) {
    pos.setXYZ(v,
      cx + (pos.getX(v) - cx) * factor,
      cy + (pos.getY(v) - cy) * factor,
      cz + (pos.getZ(v) - cz) * factor,
    );
  }
  pos.needsUpdate = true;
  if (mesh.geometry.computeVertexNormals) mesh.geometry.computeVertexNormals();
  if (mesh.geometry.boundsTree && mesh.geometry.disposeBoundsTree) mesh.geometry.disposeBoundsTree();
  return { ok: true, vertCount: touched.size, factor, centroid: [cx, cy, cz] };
}

function rotateSelectedVerts(angleRad, axis) {
  const { mesh, touched } = touchedVerts();
  if (!mesh) return { ok: false, error: 'no mesh' };
  if (typeof angleRad !== 'number' || !Number.isFinite(angleRad)) return { ok: false, error: 'bad angle' };
  if (!touched.size) return { ok: false, error: 'empty selection' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  let ax;
  if (axis === 'x') ax = new THREE.Vector3(1, 0, 0);
  else if (axis === 'y') ax = new THREE.Vector3(0, 1, 0);
  else if (axis === 'z' || axis == null) ax = new THREE.Vector3(0, 0, 1);
  else if (Array.isArray(axis) && axis.length === 3) ax = new THREE.Vector3(axis[0], axis[1], axis[2]).normalize();
  else return { ok: false, error: 'bad axis' };
  const pos = mesh.geometry.attributes.position;
  let cx = 0, cy = 0, cz = 0;
  for (const v of touched) { cx += pos.getX(v); cy += pos.getY(v); cz += pos.getZ(v); }
  cx /= touched.size; cy /= touched.size; cz /= touched.size;
  const q = new THREE.Quaternion().setFromAxisAngle(ax, angleRad);
  const tmp = new THREE.Vector3();
  for (const v of touched) {
    tmp.set(pos.getX(v) - cx, pos.getY(v) - cy, pos.getZ(v) - cz).applyQuaternion(q);
    pos.setXYZ(v, cx + tmp.x, cy + tmp.y, cz + tmp.z);
  }
  pos.needsUpdate = true;
  if (mesh.geometry.computeVertexNormals) mesh.geometry.computeVertexNormals();
  if (mesh.geometry.boundsTree && mesh.geometry.disposeBoundsTree) mesh.geometry.disposeBoundsTree();
  return { ok: true, vertCount: touched.size, angleRad, axis: [ax.x, ax.y, ax.z], centroid: [cx, cy, cz] };
}

// ─── select-all / invert (V2 slices 386/387) ─────────────────────────────
function enumerateAllEdges(idx, triCount) {
  const set = new Set();
  for (let f = 0; f < triCount; f++) {
    const a = idx[f * 3]; const b = idx[f * 3 + 1]; const c = idx[f * 3 + 2];
    set.add(a < b ? `${a}_${b}` : `${b}_${a}`);
    set.add(b < c ? `${b}_${c}` : `${c}_${b}`);
    set.add(c < a ? `${c}_${a}` : `${a}_${c}`);
  }
  return set;
}
function selectAllEdit(mode) {
  const m = activeMesh();
  if (!m || !m.geometry || !m.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  const pos = m.geometry.attributes.position;
  const idx = m.geometry.index ? m.geometry.index.array : null;
  window.__studioEditSelection.current = { vertices: [], edges: [], faces: [] };
  if (mode === 'vertex') {
    const out = []; for (let i = 0; i < pos.count; i++) out.push(i);
    window.__studioEditSelection.current.vertices = out;
  } else if (mode === 'face') {
    const triCount = idx ? Math.floor(idx.length / 3) : Math.floor(pos.count / 3);
    const out = []; for (let f = 0; f < triCount; f++) out.push(f);
    window.__studioEditSelection.current.faces = out;
  } else if (mode === 'edge') {
    if (!idx) return { ok: false, error: 'non-indexed geometry' };
    const triCount = Math.floor(idx.length / 3);
    const all = enumerateAllEdges(idx, triCount);
    const out = []; for (const k of all) { const [a, b] = k.split('_').map(Number); out.push([a, b]); }
    window.__studioEditSelection.current.edges = out;
  } else return { ok: false, error: 'bad mode' };
  const s = window.__studioEditSelection.current;
  return { ok: true, counts: { vertices: s.vertices.length, edges: s.edges.length, faces: s.faces.length } };
}
function invertEditSelection(mode) {
  const m = activeMesh();
  if (!m || !m.geometry || !m.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  const pos = m.geometry.attributes.position;
  const idx = m.geometry.index ? m.geometry.index.array : null;
  const sel = window.__studioEditSelection.current;
  if (mode === 'vertex') {
    const have = new Set(sel.vertices); const out = [];
    for (let i = 0; i < pos.count; i++) if (!have.has(i)) out.push(i);
    window.__studioEditSelection.current.vertices = out;
  } else if (mode === 'face') {
    const triCount = idx ? Math.floor(idx.length / 3) : Math.floor(pos.count / 3);
    const have = new Set(sel.faces); const out = [];
    for (let f = 0; f < triCount; f++) if (!have.has(f)) out.push(f);
    window.__studioEditSelection.current.faces = out;
  } else if (mode === 'edge') {
    if (!idx) return { ok: false, error: 'non-indexed geometry' };
    const triCount = Math.floor(idx.length / 3);
    const all = enumerateAllEdges(idx, triCount);
    const haveKey = new Set(sel.edges.map((e) => e[0] < e[1] ? `${e[0]}_${e[1]}` : `${e[1]}_${e[0]}`));
    const out = [];
    for (const k of all) {
      if (!haveKey.has(k)) { const [a, b] = k.split('_').map(Number); out.push([a, b]); }
    }
    window.__studioEditSelection.current.edges = out;
  } else return { ok: false, error: 'bad mode' };
  const s = window.__studioEditSelection.current;
  return { ok: true, counts: { vertices: s.vertices.length, edges: s.edges.length, faces: s.faces.length } };
}

// ─── extrude / inset / subdivide (V2 slices 388/389/390) ─────────────────
function rebuildGeometry(mesh, outVerts, outIdx) {
  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(outVerts, 3));
  newGeo.setIndex(outIdx);
  newGeo.computeVertexNormals();
  newGeo.computeBoundingSphere();
  mesh.geometry.dispose();
  mesh.geometry = newGeo;
}
function extrudeSelectedFaces(dist) {
  const m = activeMesh();
  if (!m || !m.geometry || !m.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  if (typeof dist !== 'number' || !Number.isFinite(dist)) return { ok: false, error: 'bad dist' };
  const sel = window.__studioEditSelection.current;
  if (!sel.faces.length) return { ok: false, error: 'no faces selected' };
  const geo = m.geometry; const idx = geo.index && geo.index.array; const posAttr = geo.attributes.position;
  if (!idx) return { ok: false, error: 'non-indexed geometry' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  const selSet = new Set(sel.faces);
  const triCount = Math.floor(idx.length / 3);
  const outVerts = []; const outIdx = [];
  for (let i = 0; i < posAttr.count; i++) outVerts.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
  for (let f = 0; f < triCount; f++) if (!selSet.has(f)) outIdx.push(idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]);
  const vA = new THREE.Vector3(); const vB = new THREE.Vector3(); const vC = new THREE.Vector3();
  const ab = new THREE.Vector3(); const ac = new THREE.Vector3(); const n = new THREE.Vector3();
  for (const f of sel.faces) {
    const ia = idx[f * 3], ib = idx[f * 3 + 1], ic = idx[f * 3 + 2];
    vA.fromBufferAttribute(posAttr, ia); vB.fromBufferAttribute(posAttr, ib); vC.fromBufferAttribute(posAttr, ic);
    ab.subVectors(vB, vA); ac.subVectors(vC, vA); n.crossVectors(ab, ac).normalize().multiplyScalar(dist);
    const nA = outVerts.length / 3; outVerts.push(vA.x + n.x, vA.y + n.y, vA.z + n.z);
    const nB = nA + 1;             outVerts.push(vB.x + n.x, vB.y + n.y, vB.z + n.z);
    const nC = nA + 2;             outVerts.push(vC.x + n.x, vC.y + n.y, vC.z + n.z);
    outIdx.push(nA, nB, nC);
    outIdx.push(ia, ib, nB); outIdx.push(ia, nB, nA);
    outIdx.push(ib, ic, nC); outIdx.push(ib, nC, nB);
    outIdx.push(ic, ia, nA); outIdx.push(ic, nA, nC);
  }
  rebuildGeometry(m, outVerts, outIdx);
  window.__studioClearEditSelection && window.__studioClearEditSelection();
  return { ok: true, addedTris: sel.faces.length * 7, vertCount: m.geometry.attributes.position.count, triCount: Math.floor(m.geometry.index.array.length / 3) };
}
function insetSelectedFaces(factor) {
  const m = activeMesh();
  if (!m || !m.geometry || !m.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  if (typeof factor !== 'number' || !Number.isFinite(factor) || factor <= 0 || factor >= 1) return { ok: false, error: 'bad factor' };
  const sel = window.__studioEditSelection.current;
  if (!sel.faces.length) return { ok: false, error: 'no faces selected' };
  const geo = m.geometry; const idx = geo.index && geo.index.array; const posAttr = geo.attributes.position;
  if (!idx) return { ok: false, error: 'non-indexed geometry' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  const selSet = new Set(sel.faces);
  const triCount = Math.floor(idx.length / 3);
  const outVerts = []; const outIdx = [];
  for (let i = 0; i < posAttr.count; i++) outVerts.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
  for (let f = 0; f < triCount; f++) if (!selSet.has(f)) outIdx.push(idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]);
  const vA = new THREE.Vector3(); const vB = new THREE.Vector3(); const vC = new THREE.Vector3();
  for (const f of sel.faces) {
    const ia = idx[f * 3], ib = idx[f * 3 + 1], ic = idx[f * 3 + 2];
    vA.fromBufferAttribute(posAttr, ia); vB.fromBufferAttribute(posAttr, ib); vC.fromBufferAttribute(posAttr, ic);
    const cx = (vA.x + vB.x + vC.x) / 3, cy = (vA.y + vB.y + vC.y) / 3, cz = (vA.z + vB.z + vC.z) / 3;
    const lerp = (v, cX, cY, cZ) => [v.x + (cX - v.x) * factor, v.y + (cY - v.y) * factor, v.z + (cZ - v.z) * factor];
    const nA = outVerts.length / 3; outVerts.push(...lerp(vA, cx, cy, cz));
    const nB = nA + 1;             outVerts.push(...lerp(vB, cx, cy, cz));
    const nC = nA + 2;             outVerts.push(...lerp(vC, cx, cy, cz));
    outIdx.push(nA, nB, nC);
    outIdx.push(ia, ib, nB); outIdx.push(ia, nB, nA);
    outIdx.push(ib, ic, nC); outIdx.push(ib, nC, nB);
    outIdx.push(ic, ia, nA); outIdx.push(ic, nA, nC);
  }
  rebuildGeometry(m, outVerts, outIdx);
  window.__studioClearEditSelection && window.__studioClearEditSelection();
  return { ok: true, addedTris: sel.faces.length * 7, vertCount: m.geometry.attributes.position.count, triCount: Math.floor(m.geometry.index.array.length / 3), factor };
}
function subdivideSelectedFaces() {
  const m = activeMesh();
  if (!m || !m.geometry || !m.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  const sel = window.__studioEditSelection.current;
  if (!sel.faces.length) return { ok: false, error: 'no faces selected' };
  const geo = m.geometry; const idx = geo.index && geo.index.array; const posAttr = geo.attributes.position;
  if (!idx) return { ok: false, error: 'non-indexed geometry' };
  if (window.__studioPushUndo) window.__studioPushUndo();
  const selSet = new Set(sel.faces);
  const triCount = Math.floor(idx.length / 3);
  const outVerts = []; const outIdx = [];
  for (let i = 0; i < posAttr.count; i++) outVerts.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
  for (let f = 0; f < triCount; f++) if (!selSet.has(f)) outIdx.push(idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2]);
  const vA = new THREE.Vector3(); const vB = new THREE.Vector3(); const vC = new THREE.Vector3();
  for (const f of sel.faces) {
    const ia = idx[f * 3], ib = idx[f * 3 + 1], ic = idx[f * 3 + 2];
    vA.fromBufferAttribute(posAttr, ia); vB.fromBufferAttribute(posAttr, ib); vC.fromBufferAttribute(posAttr, ic);
    const mAB = outVerts.length / 3; outVerts.push((vA.x + vB.x) / 2, (vA.y + vB.y) / 2, (vA.z + vB.z) / 2);
    const mBC = mAB + 1;             outVerts.push((vB.x + vC.x) / 2, (vB.y + vC.y) / 2, (vB.z + vC.z) / 2);
    const mCA = mAB + 2;             outVerts.push((vC.x + vA.x) / 2, (vC.y + vA.y) / 2, (vC.z + vA.z) / 2);
    outIdx.push(ia, mAB, mCA);
    outIdx.push(mAB, ib, mBC);
    outIdx.push(mCA, mBC, ic);
    outIdx.push(mAB, mBC, mCA);
  }
  rebuildGeometry(m, outVerts, outIdx);
  window.__studioClearEditSelection && window.__studioClearEditSelection();
  return { ok: true, addedTris: sel.faces.length * 3, vertCount: m.geometry.attributes.position.count, triCount: Math.floor(m.geometry.index.array.length / 3) };
}

// ─── Registration ────────────────────────────────────────────────────────
export function registerEditOps() {
  window.__studioPickVertexFromClick   = pickVertexFromClick;
  window.__studioPickFaceFromClick     = pickFaceFromClick;
  window.__studioPickEdgeFromClick     = pickEdgeFromClick;
  window.__studioMoveSelectedVerts     = moveSelectedVerts;
  window.__studioScaleSelectedVerts    = scaleSelectedVerts;
  window.__studioRotateSelectedVerts   = rotateSelectedVerts;
  window.__studioSelectAllEdit         = selectAllEdit;
  window.__studioInvertEditSelection   = invertEditSelection;
  window.__studioExtrudeSelectedFaces  = extrudeSelectedFaces;
  window.__studioInsetSelectedFaces    = insetSelectedFaces;
  window.__studioSubdivideSelectedFaces = subdivideSelectedFaces;
}
export function unregisterEditOps() {
  for (const k of [
    '__studioPickVertexFromClick', '__studioPickFaceFromClick', '__studioPickEdgeFromClick',
    '__studioMoveSelectedVerts', '__studioScaleSelectedVerts', '__studioRotateSelectedVerts',
    '__studioSelectAllEdit', '__studioInvertEditSelection',
    '__studioExtrudeSelectedFaces', '__studioInsetSelectedFaces', '__studioSubdivideSelectedFaces',
  ]) {
    try { delete window[k]; } catch (_) {}
  }
}
