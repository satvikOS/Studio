// ArchDisc Studio V3 — Plasticity-style unfold (planar development).
//
// Given an ordered list of face indices that form a connected strip,
// flatten the strip into the XY plane. This is the simplified
// LSCM/Pepakura recipe — no global parametrization; each face is
// hinged onto its predecessor by sharing one edge.
//
// Algorithm:
//   1. Anchor the first face: place its first vertex at origin, its
//      second along +X at the edge's true length, third in +Y by the
//      face's interior angle.
//   2. For each subsequent face in the strip, find the shared edge
//      with the previous (already-flattened) face. Rotate the new face
//      around that edge into the XY plane by replicating its third
//      vertex's true distances to the two shared endpoints.
//   3. Emit a NEW mesh containing the flattened strip — original is
//      left in place.
//
// Inputs:
//   meshUuid: source mesh uuid
//   faceIndices: ordered list of triangle indices (in the source's index
//                buffer) forming the strip
//
// Returns: { ok, uuid, faceCount, vertCount } or { ok:false, error }.

import * as THREE from 'three';
import {
  findMeshByUuid,
  pushUndo,
  ensureIndexed,
  copyVerts,
  copyIdx,
} from './common.js';

function dist3(verts, a, b) {
  const dx = verts[a * 3]     - verts[b * 3];
  const dy = verts[a * 3 + 1] - verts[b * 3 + 1];
  const dz = verts[a * 3 + 2] - verts[b * 3 + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function unfoldStrip(meshUuid, faceIndices) {
  const mesh = findMeshByUuid(meshUuid);
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) {
    return { ok: false, error: 'no mesh for uuid' };
  }
  if (!Array.isArray(faceIndices) || !faceIndices.length) {
    return { ok: false, error: 'need faceIndices[]' };
  }
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const inVerts = copyVerts(geo.attributes.position);
  const inIdx = copyIdx(geo.index);
  const triCount = inIdx.length / 3;
  const strip = faceIndices.filter((f) => Number.isInteger(f) && f >= 0 && f < triCount);
  if (!strip.length) return { ok: false, error: 'no valid faceIndices' };

  // Flat output vertex buffer (x,y,0). One entry per (face, vertSlot)
  // initially, then merged by shared-edge endpoints into a compact set.
  const flatVerts = []; // pushed as 3 floats
  const flatIdx = [];   // pushed as 3 ints
  // Map: srcVertIdx → idx in flatVerts, valid only for the latest face
  // we placed. After moving to the next face we keep the two shared-edge
  // entries because the new face hinges on them.
  // For correctness across the whole strip we keep a global lookup
  // `placedFor` so future faces can find already-placed verts they
  // share with ANY earlier flattened face.
  const placedFor = new Map(); // srcVertIdx → flatIdx

  function addFlatVert(srcVertIdx, x, y) {
    const flatIdxOut = flatVerts.length / 3;
    flatVerts.push(x, y, 0);
    placedFor.set(srcVertIdx, flatIdxOut);
    return flatIdxOut;
  }

  // Face 0 anchor: place (a,b,c) so a→(0,0), b→(|ab|,0), c found by
  // distance to a and b (signed +Y).
  const f0 = strip[0];
  const a0 = inIdx[f0 * 3], b0 = inIdx[f0 * 3 + 1], c0 = inIdx[f0 * 3 + 2];
  const ab = dist3(inVerts, a0, b0);
  const ac = dist3(inVerts, a0, c0);
  const bc = dist3(inVerts, b0, c0);
  // Trilateration: a at origin, b at (ab, 0). Solve c at (cx, cy).
  // cx = (ac^2 - bc^2 + ab^2) / (2 ab)
  // cy = +sqrt(ac^2 - cx^2)  (choose positive Y)
  let cx0 = 0, cy0 = 0;
  if (ab > 1e-9) {
    cx0 = (ac * ac - bc * bc + ab * ab) / (2 * ab);
    const sq = ac * ac - cx0 * cx0;
    cy0 = sq > 0 ? Math.sqrt(sq) : 0;
  }
  const Fa0 = addFlatVert(a0, 0, 0);
  const Fb0 = addFlatVert(b0, ab, 0);
  const Fc0 = addFlatVert(c0, cx0, cy0);
  flatIdx.push(Fa0, Fb0, Fc0);

  let unfolded = 1;
  let prev = { face: f0, a: a0, b: b0, c: c0, Fa: Fa0, Fb: Fb0, Fc: Fc0 };

  for (let s = 1; s < strip.length; s++) {
    const f = strip[s];
    const fa = inIdx[f * 3], fb = inIdx[f * 3 + 1], fc = inIdx[f * 3 + 2];
    const cur = [fa, fb, fc];
    // Find which two verts are shared with the previous face.
    const prevSet = new Set([prev.a, prev.b, prev.c]);
    const shared = cur.filter((v) => prevSet.has(v));
    if (shared.length < 2) {
      // Strip discontinuity — skip this face but keep going.
      continue;
    }
    const sA = shared[0], sB = shared[1];
    const third = cur.find((v) => v !== sA && v !== sB);
    if (third == null) continue;

    // True-3D distances from `third` to sA and sB.
    const dThirdA = dist3(inVerts, third, sA);
    const dThirdB = dist3(inVerts, third, sB);

    // Already-placed flat positions of sA, sB.
    const fA = placedFor.get(sA);
    const fB = placedFor.get(sB);
    if (fA == null || fB == null) continue;

    const Ax = flatVerts[fA * 3];
    const Ay = flatVerts[fA * 3 + 1];
    const Bx = flatVerts[fB * 3];
    const By = flatVerts[fB * 3 + 1];

    // Solve for third's 2D position: two circle intersection (radii
    // dThirdA from A, dThirdB from B). Pick the side OPPOSITE the
    // previous-face third so the strip un-folds outward.
    const dAB = Math.hypot(Bx - Ax, By - Ay);
    if (dAB < 1e-9) continue;
    const aS = (dThirdA * dThirdA - dThirdB * dThirdB + dAB * dAB) / (2 * dAB);
    const hSq = dThirdA * dThirdA - aS * aS;
    const h = hSq > 0 ? Math.sqrt(hSq) : 0;
    const mx = Ax + aS * (Bx - Ax) / dAB;
    const my = Ay + aS * (By - Ay) / dAB;
    const perpX = -(By - Ay) / dAB;
    const perpY =  (Bx - Ax) / dAB;
    // Two candidates ±h along (perpX,perpY); pick the one with greater
    // distance from the prev face's third (so we hinge OUTWARD).
    const prevThirdSrc = (prev.a !== sA && prev.a !== sB) ? prev.a
      : (prev.b !== sA && prev.b !== sB) ? prev.b
      : prev.c;
    const prevThirdFlat = placedFor.get(prevThirdSrc);
    const pX = prevThirdFlat != null ? flatVerts[prevThirdFlat * 3] : mx;
    const pY = prevThirdFlat != null ? flatVerts[prevThirdFlat * 3 + 1] : my;
    const cand1x = mx + perpX * h, cand1y = my + perpY * h;
    const cand2x = mx - perpX * h, cand2y = my - perpY * h;
    const d1 = Math.hypot(cand1x - pX, cand1y - pY);
    const d2 = Math.hypot(cand2x - pX, cand2y - pY);
    const tx = d1 >= d2 ? cand1x : cand2x;
    const ty = d1 >= d2 ? cand1y : cand2y;

    let Fthird = placedFor.get(third);
    if (Fthird == null) Fthird = addFlatVert(third, tx, ty);

    // Emit flat triangle reconstructing original (fa,fb,fc) ordering.
    const map = new Map([[sA, fA], [sB, fB], [third, Fthird]]);
    flatIdx.push(map.get(fa), map.get(fb), map.get(fc));
    prev = { face: f, a: fa, b: fb, c: fc,
      Fa: map.get(fa), Fb: map.get(fb), Fc: map.get(fc) };
    unfolded++;
  }

  if (unfolded < 1) return { ok: false, error: 'nothing unfolded' };

  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(flatVerts, 3));
  newGeo.setIndex(
    flatIdx.length > 65535
      ? new THREE.Uint32BufferAttribute(flatIdx, 1)
      : new THREE.Uint16BufferAttribute(flatIdx, 1),
  );
  newGeo.computeVertexNormals();
  newGeo.computeBoundingBox();
  newGeo.computeBoundingSphere();

  const sourceMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const material = sourceMat && sourceMat.clone
    ? sourceMat.clone()
    : new THREE.MeshStandardMaterial({
        color: 0xb2c0ce, side: THREE.DoubleSide, metalness: 0.08, roughness: 0.65,
      });
  if (material && 'side' in material) material.side = THREE.DoubleSide;

  const out = new THREE.Mesh(newGeo, material);
  out.castShadow = true;
  out.receiveShadow = true;
  out.name = `${mesh.name || 'mesh'}_unfold`;
  // Place the unfolded strip slightly offset from the source so it's
  // visible without overlapping.
  out.position.set(0, 0.001, 0);
  out.userData = {
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: 'surface-unfold',
    archdiscStudioUnfoldFrom: mesh.uuid,
    archdiscStudioUnfoldFaceCount: unfolded,
    pickable: true,
  };

  const parent = mesh.parent
    || (typeof window !== 'undefined' && window.__archdiscScene)
    || (typeof window !== 'undefined' && window.__archdiscViewport
        && window.__archdiscViewport.scene);
  if (parent && parent.add) parent.add(out);

  return {
    ok: true,
    uuid: out.uuid,
    sourceUuid: mesh.uuid,
    faceCount: unfolded,
    vertCount: flatVerts.length / 3,
    requestedFaces: strip.length,
  };
}

export default unfoldStrip;
