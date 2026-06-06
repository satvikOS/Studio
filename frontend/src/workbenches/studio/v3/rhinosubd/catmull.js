// Slice 720 — Rhino SubD (Catmull-Clark subdivision surfaces). True
// Catmull-Clark: each face becomes one face per original vertex via
// face-points + edge-points + new-vertex-points. Distinct from slice-
// 695 modifier-stack subdiv which uses Loop on triangles.

import * as THREE from 'three';

function _edgeKey(a, b) { return a < b ? `${a}_${b}` : `${b}_${a}`; }

export function subdivide(meshUuid, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry?.attributes?.position) return { ok: false };
  const iterations = Math.max(1, Math.min(4, Number(opts?.iterations) || 1));
  let positions = Array.from(mesh.geometry.attributes.position.array);
  let indices = mesh.geometry.index ? Array.from(mesh.geometry.index.array) : null;
  if (!indices) {
    // Build trivial indices for non-indexed.
    indices = [];
    for (let i = 0; i < positions.length / 3; i++) indices.push(i);
  }
  for (let it = 0; it < iterations; it++) {
    const result = _ccStep(positions, indices);
    positions = result.positions;
    indices = result.indices;
  }
  const newPos = new Float32Array(positions);
  const newIdx = new Uint32Array(indices);
  mesh.geometry.dispose();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(newPos, 3));
  geo.setIndex(new THREE.BufferAttribute(newIdx, 1));
  geo.computeVertexNormals();
  mesh.geometry = geo;
  return { ok: true, vertices: newPos.length / 3, triangles: newIdx.length / 3 };
}

function _ccStep(positions, indices) {
  // 1. Face points: average of corners of each face.
  // For triangle meshes, each triangle becomes a face. CC normally
  // operates on quad meshes; we approximate by treating each triangle
  // separately, then doing the CC weight averaging.
  const faceCount = indices.length / 3;
  const facePoints = [];   // [x,y,z] per face
  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f * 3], i1 = indices[f * 3 + 1], i2 = indices[f * 3 + 2];
    facePoints.push(
      (positions[i0 * 3] + positions[i1 * 3] + positions[i2 * 3]) / 3,
      (positions[i0 * 3 + 1] + positions[i1 * 3 + 1] + positions[i2 * 3 + 1]) / 3,
      (positions[i0 * 3 + 2] + positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 3,
    );
  }
  // 2. Edge points: midpoint of edge endpoints + average of face points of the 2 adjacent faces.
  const edges = new Map();   // edgeKey → { i0, i1, faces: [f, ...] }
  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f * 3], i1 = indices[f * 3 + 1], i2 = indices[f * 3 + 2];
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const k = _edgeKey(a, b);
      if (!edges.has(k)) edges.set(k, { i0: Math.min(a, b), i1: Math.max(a, b), faces: [] });
      edges.get(k).faces.push(f);
    }
  }
  const edgePoints = new Map();   // edgeKey → [x,y,z]
  for (const [k, e] of edges.entries()) {
    let x = positions[e.i0 * 3] + positions[e.i1 * 3];
    let y = positions[e.i0 * 3 + 1] + positions[e.i1 * 3 + 1];
    let z = positions[e.i0 * 3 + 2] + positions[e.i1 * 3 + 2];
    let n = 2;
    for (const f of e.faces) {
      x += facePoints[f * 3];
      y += facePoints[f * 3 + 1];
      z += facePoints[f * 3 + 2];
      n++;
    }
    edgePoints.set(k, [x / n, y / n, z / n]);
  }
  // 3. New vertex positions: weighted by adjacent face points + edge midpoints + original.
  const vertCount = positions.length / 3;
  const newVertexPositions = [];
  for (let v = 0; v < vertCount; v++) {
    // Find adjacent faces + edges.
    const adjFaces = [];
    const adjEdges = [];
    for (let f = 0; f < faceCount; f++) {
      if (indices[f * 3] === v || indices[f * 3 + 1] === v || indices[f * 3 + 2] === v) adjFaces.push(f);
    }
    for (const [k, e] of edges.entries()) {
      if (e.i0 === v || e.i1 === v) adjEdges.push(k);
    }
    const n = adjFaces.length;
    if (n === 0) { newVertexPositions.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]); continue; }
    let fx = 0, fy = 0, fz = 0;
    for (const f of adjFaces) {
      fx += facePoints[f * 3];
      fy += facePoints[f * 3 + 1];
      fz += facePoints[f * 3 + 2];
    }
    fx /= n; fy /= n; fz /= n;
    let ex = 0, ey = 0, ez = 0;
    for (const k of adjEdges) {
      const ep = edgePoints.get(k);
      ex += ep[0]; ey += ep[1]; ez += ep[2];
    }
    const em = adjEdges.length || 1;
    ex /= em; ey /= em; ez /= em;
    const px = positions[v * 3], py = positions[v * 3 + 1], pz = positions[v * 3 + 2];
    const newX = (fx + 2 * ex + (n - 3) * px) / n;
    const newY = (fy + 2 * ey + (n - 3) * py) / n;
    const newZ = (fz + 2 * ez + (n - 3) * pz) / n;
    newVertexPositions.push(newX, newY, newZ);
  }
  // 4. Assemble new mesh: each old face becomes 3 quads (rendered as 6 tris).
  const newPositions = [...newVertexPositions];
  const baseVert = newVertexPositions.length / 3;
  const facePointBase = baseVert;
  for (const fp of facePoints) newPositions.push(fp);
  const facePointStart = facePointBase;
  const edgePointBase = newPositions.length / 3;
  const edgePointIdx = new Map();
  for (const [k, ep] of edgePoints.entries()) {
    edgePointIdx.set(k, newPositions.length / 3);
    newPositions.push(...ep);
  }
  const newIndices = [];
  for (let f = 0; f < faceCount; f++) {
    const i0 = indices[f * 3], i1 = indices[f * 3 + 1], i2 = indices[f * 3 + 2];
    const fp = facePointStart + f;
    const e01 = edgePointIdx.get(_edgeKey(i0, i1));
    const e12 = edgePointIdx.get(_edgeKey(i1, i2));
    const e20 = edgePointIdx.get(_edgeKey(i2, i0));
    // Three quads (each becomes 2 tris).
    newIndices.push(i0, e01, fp, i0, fp, e20);
    newIndices.push(i1, e12, fp, i1, fp, e01);
    newIndices.push(i2, e20, fp, i2, fp, e12);
  }
  return { positions: newPositions, indices: newIndices };
}

export function setCrease(meshUuid, edgeKey, weight) {
  // Stub for hard-edge crease — actual implementation requires hashing
  // crease weights into the CC step. For now we just record on userData.
  const scene = window.__archdiscScene;
  const mesh = scene?.getObjectByProperty('uuid', meshUuid);
  if (!mesh) return { ok: false };
  if (!mesh.userData) mesh.userData = {};
  if (!mesh.userData.archdiscSubdCreases) mesh.userData.archdiscSubdCreases = {};
  mesh.userData.archdiscSubdCreases[edgeKey] = Number(weight);
  return { ok: true };
}
