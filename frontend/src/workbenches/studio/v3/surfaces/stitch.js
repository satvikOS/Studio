// ArchDisc Studio V3 — Plasticity-style stitch / sew edge loops.
//
// Given two edge loops (one on each of two scene meshes), sew them
// together by adding a NEW bridging mesh of quads (2 tris each)
// connecting corresponding loop vertices in order.
//
// Inputs:
//   meshUuidA, meshUuidB: source mesh uuids
//   loopA, loopB: ordered arrays of vertex indices (into each mesh's
//                 position buffer). Both loops must have the same
//                 length OR length 0 → in which case we auto-pick the
//                 first detected boundary loop on that mesh.
//
// The bridge is a new standalone mesh (NOT a mutation of A or B) so this
// is a Plasticity-style "Sew" operator that yields a join geometry the
// designer can keep, edit, or convert further.
//
// Returns: { ok, uuid, pairs, tris } or { ok:false, error }.

import * as THREE from 'three';
import {
  findMeshByUuid,
  pushUndo,
  ensureIndexed,
  copyVerts,
  copyIdx,
  boundaryEdges,
} from './common.js';

// Reconstruct an ordered boundary loop from one mesh, starting at any
// boundary vert. Returns Array<number> of vertex indices, or null.
function firstBoundaryLoop(idx) {
  const edges = boundaryEdges(idx);
  if (!edges.length) return null;
  const nextMap = new Map();
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    if (!nextMap.has(e.a)) nextMap.set(e.a, []);
    nextMap.get(e.a).push({ next: e.b, idx: i });
  }
  const used = new Uint8Array(edges.length);
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    const start = edges[i].a;
    const loop = [start];
    used[i] = 1;
    let cur = edges[i].b;
    let guard = 0;
    while (cur !== start && guard++ < edges.length + 4) {
      loop.push(cur);
      const cands = nextMap.get(cur) || [];
      let picked = -1;
      for (const c of cands) if (!used[c.idx]) { picked = c.idx; break; }
      if (picked < 0) break;
      used[picked] = 1;
      cur = edges[picked].next;
    }
    if (loop.length >= 3) return loop;
  }
  return null;
}

export function stitchLoops(meshUuidA, loopA, meshUuidB, loopB) {
  const meshA = findMeshByUuid(meshUuidA);
  const meshB = findMeshByUuid(meshUuidB);
  if (!meshA || !meshA.geometry) return { ok: false, error: 'no mesh A' };
  if (!meshB || !meshB.geometry) return { ok: false, error: 'no mesh B' };
  pushUndo();

  ensureIndexed(meshA.geometry);
  ensureIndexed(meshB.geometry);
  const vertsA = copyVerts(meshA.geometry.attributes.position);
  const vertsB = copyVerts(meshB.geometry.attributes.position);
  const idxA   = copyIdx(meshA.geometry.index);
  const idxB   = copyIdx(meshB.geometry.index);

  let LA = Array.isArray(loopA) && loopA.length ? loopA.slice() : firstBoundaryLoop(idxA);
  let LB = Array.isArray(loopB) && loopB.length ? loopB.slice() : firstBoundaryLoop(idxB);
  if (!LA || LA.length < 3) return { ok: false, error: 'loopA missing / too short' };
  if (!LB || LB.length < 3) return { ok: false, error: 'loopB missing / too short' };

  // Validate indices are in range.
  const vA = vertsA.length / 3;
  const vB = vertsB.length / 3;
  LA = LA.filter((i) => Number.isInteger(i) && i >= 0 && i < vA);
  LB = LB.filter((i) => Number.isInteger(i) && i >= 0 && i < vB);
  if (LA.length < 3 || LB.length < 3) return { ok: false, error: 'loops invalid post-filter' };

  // Equalize lengths by repeating last index of the shorter loop. A more
  // accurate stitch would arc-length resample both; for now this gives
  // a usable join + leaves loops the user can re-stitch later if they
  // want a higher-fidelity join.
  const N = Math.max(LA.length, LB.length);
  while (LA.length < N) LA.push(LA[LA.length - 1]);
  while (LB.length < N) LB.push(LB[LB.length - 1]);

  // Build a fresh mesh with 2 * N verts (loop A endpoints in mesh-LOCAL
  // space transformed by meshA.matrixWorld, then loop B in B's world
  // space). The bridge lives in WORLD coords so it stays correct
  // regardless of source-mesh transforms.
  meshA.updateMatrixWorld(true);
  meshB.updateMatrixWorld(true);
  const mA = meshA.matrixWorld;
  const mB = meshB.matrixWorld;
  const tmp = new THREE.Vector3();

  const newVerts = new Array(N * 2 * 3);
  for (let i = 0; i < N; i++) {
    const ai = LA[i];
    tmp.set(vertsA[ai * 3], vertsA[ai * 3 + 1], vertsA[ai * 3 + 2]).applyMatrix4(mA);
    newVerts[i * 3]     = tmp.x;
    newVerts[i * 3 + 1] = tmp.y;
    newVerts[i * 3 + 2] = tmp.z;
  }
  for (let i = 0; i < N; i++) {
    const bi = LB[i];
    tmp.set(vertsB[bi * 3], vertsB[bi * 3 + 1], vertsB[bi * 3 + 2]).applyMatrix4(mB);
    const off = (N + i) * 3;
    newVerts[off]     = tmp.x;
    newVerts[off + 1] = tmp.y;
    newVerts[off + 2] = tmp.z;
  }

  // Bridging quads: A[i] → A[i+1] → B[i+1] → B[i].
  const newIdx = [];
  for (let i = 0; i < N; i++) {
    const ai0 = i;
    const ai1 = (i + 1) % N;
    const bi0 = N + i;
    const bi1 = N + ((i + 1) % N);
    newIdx.push(ai0, ai1, bi1);
    newIdx.push(ai0, bi1, bi0);
  }

  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(newVerts, 3));
  newGeo.setIndex(
    newIdx.length > 65535
      ? new THREE.Uint32BufferAttribute(newIdx, 1)
      : new THREE.Uint16BufferAttribute(newIdx, 1),
  );
  newGeo.computeVertexNormals();
  newGeo.computeBoundingBox();
  newGeo.computeBoundingSphere();

  const material = new THREE.MeshStandardMaterial({
    color: 0x9fd9c4, metalness: 0.12, roughness: 0.55,
    side: THREE.DoubleSide,
  });
  const out = new THREE.Mesh(newGeo, material);
  out.castShadow = true;
  out.receiveShadow = true;
  out.name = `stitch(${meshA.name || 'A'}↔${meshB.name || 'B'})`;
  out.userData = {
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: 'surface-stitch',
    archdiscStudioStitchA: meshA.uuid,
    archdiscStudioStitchB: meshB.uuid,
    archdiscStudioStitchPairs: N,
    pickable: true,
  };

  const parent = meshA.parent
    || (typeof window !== 'undefined' && window.__archdiscScene)
    || (typeof window !== 'undefined' && window.__archdiscViewport
        && window.__archdiscViewport.scene);
  if (parent && parent.add) parent.add(out);

  return {
    ok: true,
    uuid: out.uuid,
    sourceA: meshA.uuid,
    sourceB: meshB.uuid,
    pairs: N,
    tris: newIdx.length / 3,
    vertCount: newVerts.length / 3,
  };
}

export default stitchLoops;
