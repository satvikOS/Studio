// ArchDisc Studio V3 — Plasticity-style chamfer edge.
//
// A chamfer is the degenerate-segments version of a fillet: instead of N
// transition quads following a quarter arc, we drop in a SINGLE flat
// bevel quad between the two faces sharing the given edge. The bevel
// width is `distance` (the slice contract calls it that to mirror MoI's
// label).
//
// This is intentionally distinct from Blender-style edge bevel (slice
// 682's edit/ ops) — that one operates on the active selection through
// edit-mode UI; here we resolve everything by uuid + edgeKey, which is
// how Plasticity / MoI / Onshape style B-Rep ops are surfaced.

import * as THREE from 'three';
import {
  findMeshByUuid,
  pushUndo,
  ensureIndexed,
  copyVerts,
  copyIdx,
  rebuildGeometry,
  parseEdgeKey,
} from './common.js';

export function chamferEdge(meshUuid, edgeKey, distance) {
  const mesh = findMeshByUuid(meshUuid);
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) {
    return { ok: false, error: 'no mesh for uuid' };
  }
  const d = Number.isFinite(+distance) ? +distance : 0.05;
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

  const sharing = [];
  for (let f = 0; f < triCount; f++) {
    const a = inIdx[f * 3], b = inIdx[f * 3 + 1], c = inIdx[f * 3 + 2];
    const has = (i) => (a === i || b === i || c === i);
    if (has(va) && has(vb)) sharing.push(f);
    if (sharing.length === 2) break;
  }
  if (sharing.length < 2) return { ok: false, error: 'edge not shared by 2 faces' };

  const [f0, f1] = sharing;
  function thirdVert(f) {
    const a = inIdx[f * 3], b = inIdx[f * 3 + 1], c = inIdx[f * 3 + 2];
    for (const v of [a, b, c]) if (v !== va && v !== vb) return v;
    return -1;
  }
  const t0 = thirdVert(f0);
  const t1 = thirdVert(f1);
  if (t0 < 0 || t1 < 0) return { ok: false, error: 'degenerate adjacent face' };

  // Edge direction.
  const A = new THREE.Vector3(verts[va * 3], verts[va * 3 + 1], verts[va * 3 + 2]);
  const B = new THREE.Vector3(verts[vb * 3], verts[vb * 3 + 1], verts[vb * 3 + 2]);
  const edgeDir = new THREE.Vector3().subVectors(B, A).normalize();

  // Inward dirs (perpendicular to edge, toward each opposite vert).
  function inwardDir(v, opp) {
    const O = new THREE.Vector3(verts[opp * 3], verts[opp * 3 + 1], verts[opp * 3 + 2]);
    const V = new THREE.Vector3(verts[v * 3], verts[v * 3 + 1], verts[v * 3 + 2]);
    const dv = new THREE.Vector3().subVectors(O, V);
    const along = edgeDir.clone().multiplyScalar(dv.dot(edgeDir));
    return dv.sub(along).normalize();
  }
  const inA0 = inwardDir(va, t0);
  const inA1 = inwardDir(va, t1);
  const inB0 = inwardDir(vb, t0);
  const inB1 = inwardDir(vb, t1);

  // Four new bevel verts pushed off the edge endpoints into each face.
  const newAonF0 = verts.length / 3;
  verts.push(A.x + inA0.x * d, A.y + inA0.y * d, A.z + inA0.z * d);
  const newAonF1 = verts.length / 3;
  verts.push(A.x + inA1.x * d, A.y + inA1.y * d, A.z + inA1.z * d);
  const newBonF0 = verts.length / 3;
  verts.push(B.x + inB0.x * d, B.y + inB0.y * d, B.z + inB0.z * d);
  const newBonF1 = verts.length / 3;
  verts.push(B.x + inB1.x * d, B.y + inB1.y * d, B.z + inB1.z * d);

  // Drop f0, f1, rebuild with reconnections to the new verts.
  const outIdx = [];
  let removed = 0;
  for (let f = 0; f < triCount; f++) {
    if (f === f0 || f === f1) { removed++; continue; }
    outIdx.push(inIdx[f * 3], inIdx[f * 3 + 1], inIdx[f * 3 + 2]);
  }

  // f0 reconnect: (newAonF0, newBonF0, t0) becomes the new f0.
  outIdx.push(newAonF0, newBonF0, t0);
  // f1 reconnect: (newAonF1, t1, newBonF1).
  outIdx.push(newAonF1, t1, newBonF1);
  // Single bevel quad bridging f0-side to f1-side at A and B.
  outIdx.push(newAonF0, newAonF1, newBonF1);
  outIdx.push(newAonF0, newBonF1, newBonF0);

  rebuildGeometry(mesh, verts, outIdx);
  return {
    ok: true,
    edgeKey,
    distance: d,
    addedTris: 4,
    removedTris: removed,
    vertCount: verts.length / 3,
    faceCount: outIdx.length / 3,
    bevelVerts: [newAonF0, newAonF1, newBonF0, newBonF1],
  };
}

export default chamferEdge;
