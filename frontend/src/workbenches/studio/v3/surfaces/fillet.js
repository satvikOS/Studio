// ArchDisc Studio V3 — Plasticity-style fillet edge.
//
// Mesh-based fillet: identify two adjacent triangles sharing the given
// edge, then replace them with N transition quads that follow a
// quarter-arc swept between the two face normals. Because Studio is
// tri-only (no NURBS kernel here — that lives in Forge / SP-N+ Forge-N
// slices), the "fillet" is an approximation by tessellation but it
// produces a visually rounded transition that scales by `radius` and
// gets smoother with more `segments`.
//
// Inputs:
//   meshUuid:  THREE mesh uuid (scene-resident)
//   edgeKey:   "minIdx_maxIdx" — vertex pair (see common edgeKey helper).
//   radius:    arc radius (world units, in mesh-local space).
//   segments:  number of slices in the quarter arc (>=1).
//
// Returns:    { ok, addedTris, removedTris, vertCount, faceCount }
//             or { ok: false, error }.

import * as THREE from 'three';
import {
  findMeshByUuid,
  pushUndo,
  ensureIndexed,
  copyVerts,
  copyIdx,
  rebuildGeometry,
  parseEdgeKey,
  triNormalIdx,
} from './common.js';

export function filletEdge(meshUuid, edgeKey, radius, segments) {
  const mesh = findMeshByUuid(meshUuid);
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) {
    return { ok: false, error: 'no mesh for uuid' };
  }
  const r = Number.isFinite(+radius) ? +radius : 0.05;
  const segs = Math.max(1, Math.floor(Number.isFinite(+segments) ? +segments : 4));
  const ek = parseEdgeKey(edgeKey);
  if (!ek) return { ok: false, error: 'bad edgeKey' };
  const [va, vb] = ek;
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const verts = copyVerts(geo.attributes.position);
  const inIdx = copyIdx(geo.index);
  const triCount = inIdx.length / 3;
  if (va < 0 || vb < 0 || va >= verts.length / 3 || vb >= verts.length / 3) {
    return { ok: false, error: 'edge vert OOB' };
  }

  // Find the two faces that share edge (va,vb).
  const sharing = [];
  for (let f = 0; f < triCount; f++) {
    const a = inIdx[f * 3], b = inIdx[f * 3 + 1], c = inIdx[f * 3 + 2];
    const has = (i) => (a === i || b === i || c === i);
    if (has(va) && has(vb)) sharing.push(f);
    if (sharing.length === 2) break;
  }
  if (sharing.length < 2) return { ok: false, error: 'edge not shared by 2 faces' };

  const [f0, f1] = sharing;
  // Each face's third vertex (the one that isn't on the shared edge).
  function thirdVert(f) {
    const a = inIdx[f * 3], b = inIdx[f * 3 + 1], c = inIdx[f * 3 + 2];
    for (const v of [a, b, c]) if (v !== va && v !== vb) return v;
    return -1;
  }
  const t0 = thirdVert(f0);
  const t1 = thirdVert(f1);
  if (t0 < 0 || t1 < 0) return { ok: false, error: 'degenerate adjacent face' };

  // Build the two face normals.
  const n0 = new THREE.Vector3();
  const n1 = new THREE.Vector3();
  triNormalIdx(verts, inIdx[f0 * 3], inIdx[f0 * 3 + 1], inIdx[f0 * 3 + 2], n0);
  triNormalIdx(verts, inIdx[f1 * 3], inIdx[f1 * 3 + 1], inIdx[f1 * 3 + 2], n1);

  // Edge direction.
  const A = new THREE.Vector3(verts[va * 3], verts[va * 3 + 1], verts[va * 3 + 2]);
  const B = new THREE.Vector3(verts[vb * 3], verts[vb * 3 + 1], verts[vb * 3 + 2]);
  const edgeDir = new THREE.Vector3().subVectors(B, A).normalize();

  // Per-endpoint inward directions toward the opposite third vertex
  // (projected perpendicular to the edge). Used to push the edge back
  // toward each face plane by radius before bridging.
  function inwardDir(v, opp) {
    const O = new THREE.Vector3(verts[opp * 3], verts[opp * 3 + 1], verts[opp * 3 + 2]);
    const V = new THREE.Vector3(verts[v * 3], verts[v * 3 + 1], verts[v * 3 + 2]);
    const d = new THREE.Vector3().subVectors(O, V);
    // Project off edgeDir.
    const along = edgeDir.clone().multiplyScalar(d.dot(edgeDir));
    return d.sub(along).normalize();
  }
  const inA0 = inwardDir(va, t0);
  const inA1 = inwardDir(va, t1);
  const inB0 = inwardDir(vb, t0);
  const inB1 = inwardDir(vb, t1);

  // The arc spans an angle θ between -n0 and -n1 around the edge axis.
  // We build the arc as a series of (segs+1) points pushed off the edge
  // by `radius` in the bisector of the two inward dirs.
  const arcA = []; // points along arc at vert A
  const arcB = []; // points along arc at vert B
  for (let s = 0; s <= segs; s++) {
    const t = s / segs;
    // Spherical-like blend between in0 and in1.
    const blendA = new THREE.Vector3().copy(inA0).multiplyScalar(1 - t)
      .addScaledVector(inA1, t).normalize();
    const blendB = new THREE.Vector3().copy(inB0).multiplyScalar(1 - t)
      .addScaledVector(inB1, t).normalize();
    arcA.push(new THREE.Vector3()
      .copy(A).addScaledVector(blendA, r));
    arcB.push(new THREE.Vector3()
      .copy(B).addScaledVector(blendB, r));
  }

  // Push new arc verts onto the vertex buffer; remember their indices.
  const aIdx = [];
  const bIdx = [];
  for (let s = 0; s <= segs; s++) {
    aIdx.push(verts.length / 3);
    verts.push(arcA[s].x, arcA[s].y, arcA[s].z);
    bIdx.push(verts.length / 3);
    verts.push(arcB[s].x, arcB[s].y, arcB[s].z);
  }

  // Rebuild the index: drop f0, f1, replace with N bridging quads + two
  // end caps that reconnect arc[0]/arc[segs] to t0/t1 respectively.
  const outIdx = [];
  let removed = 0;
  for (let f = 0; f < triCount; f++) {
    if (f === f0 || f === f1) { removed++; continue; }
    outIdx.push(inIdx[f * 3], inIdx[f * 3 + 1], inIdx[f * 3 + 2]);
  }

  let added = 0;
  // N quads bridging arc steps s → s+1 between A and B side.
  for (let s = 0; s < segs; s++) {
    const a0 = aIdx[s],     a1 = aIdx[s + 1];
    const b0 = bIdx[s],     b1 = bIdx[s + 1];
    outIdx.push(a0, b0, b1);
    outIdx.push(a0, b1, a1);
    added += 2;
  }
  // End caps reconnect first arc edge (s=0) into f0's third vertex and
  // last arc edge (s=segs) into f1's third vertex.
  outIdx.push(aIdx[0], bIdx[0], t0);
  outIdx.push(aIdx[segs], t1, bIdx[segs]);
  added += 2;

  rebuildGeometry(mesh, verts, outIdx);
  return {
    ok: true,
    edgeKey,
    radius: r,
    segments: segs,
    addedTris: added,
    removedTris: removed,
    vertCount: verts.length / 3,
    faceCount: outIdx.length / 3,
  };
}

export default filletEdge;
