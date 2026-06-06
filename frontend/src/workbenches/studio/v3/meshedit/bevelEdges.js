// ArchDisc Studio V3 — Bevel Edges (slice 756).
//
// Maya/Modo/Blender Bevel: each MARKED edge is replaced with TWO parallel
// edges offset by `width` along the surface (one on each adjacent face),
// and the gap between them is filled with a strip of quads (one quad per
// beveled edge). The endpoints of the bevel strip share vertices where
// successive beveled edges meet — but for simplicity this slice handles
// each edge independently (the canonical Maya behaviour for a single
// edge selection); chained corner-resolution is the next slice's job.
//
// Real algorithm — pure JS, takes (geometry, edgePairs, width) → rebuilt
// indexed BufferGeometry with the bevel strip quads stitched in.
//
//   geometry — input THREE.BufferGeometry (positions + index).
//   edgePairs — array of [vA, vB] vertex-index pairs. Each pair MUST be
//               an existing edge of the mesh (i.e. the two verts share
//               at least one triangle).
//   width — perpendicular offset distance in mesh-local units (must be
//           > 0; typically 0.01 - 0.5 of mesh size).
//
// For each beveled edge:
//   1. Find the two incident triangles ta, tb (the edge's "wing" faces).
//      If only one (boundary edge): skip — bevels need both wings.
//   2. Compute each wing's surface normal nA, nB.
//   3. Edge direction e = normalize(vB - vA).
//   4. Offset direction inside each wing = (n × e) flipped so it points
//      INTO the wing's triangle.
//   5. Duplicate (vA, vB) → (vA_left, vB_left) shifted by width along
//      wingA's offset, and (vA_right, vB_right) along wingB's offset.
//   6. Re-wire the wing triangles to use the SHIFTED verts instead of
//      the original (vA, vB), and emit a connecting quad
//      [vA_left, vB_left, vB_right, vA_right] between the two new rims.
//
// Note: This is a per-edge bevel. The output mesh stays indexed.

import * as THREE from 'three';

const _EPS = 1e-9;

function _vertsCopy(posAttr) {
  const out = [];
  for (let i = 0; i < posAttr.count; i++) {
    out.push(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
  }
  return out;
}

function _idxCopy(geom, posCount) {
  if (geom.index) {
    const idx = geom.index;
    const out = new Array(idx.count);
    for (let i = 0; i < idx.count; i++) out[i] = idx.getX(i);
    return out;
  }
  const out = new Array(posCount);
  for (let i = 0; i < posCount; i++) out[i] = i;
  return out;
}

function _edgeKey(a, b) { return a < b ? `${a}_${b}` : `${b}_${a}`; }

// edgeKey → [triIdx0, triIdx1?]   (0-2 triangles per edge)
function _buildEdgeFaceMap(idxArr, triCount) {
  const map = new Map();
  for (let f = 0; f < triCount; f++) {
    const a = idxArr[f * 3], b = idxArr[f * 3 + 1], c = idxArr[f * 3 + 2];
    for (const k of [_edgeKey(a, b), _edgeKey(b, c), _edgeKey(c, a)]) {
      let arr = map.get(k);
      if (!arr) { arr = []; map.set(k, arr); }
      arr.push(f);
    }
  }
  return map;
}

function _triNormal(verts, i0, i1, i2) {
  const ax = verts[i0 * 3],     ay = verts[i0 * 3 + 1], az = verts[i0 * 3 + 2];
  const bx = verts[i1 * 3],     by = verts[i1 * 3 + 1], bz = verts[i1 * 3 + 2];
  const cx = verts[i2 * 3],     cy = verts[i2 * 3 + 1], cz = verts[i2 * 3 + 2];
  const ex = bx - ax, ey = by - ay, ez = bz - az;
  const fx = cx - ax, fy = cy - ay, fz = cz - az;
  const nx = ey * fz - ez * fy;
  const ny = ez * fx - ex * fz;
  const nz = ex * fy - ey * fx;
  const L = Math.hypot(nx, ny, nz);
  if (L < _EPS) return [0, 1, 0];
  return [nx / L, ny / L, nz / L];
}

// Third vertex of a triangle that is NOT a or b.
function _otherCorner(idxArr, triIdx, a, b) {
  const i0 = idxArr[triIdx * 3], i1 = idxArr[triIdx * 3 + 1], i2 = idxArr[triIdx * 3 + 2];
  if (i0 !== a && i0 !== b) return i0;
  if (i1 !== a && i1 !== b) return i1;
  return i2;
}

// In-triangle offset direction perpendicular to edge a→b, pointing
// INTO the wing (toward the third vertex).
function _wingOffsetDir(verts, normal, vA, vB, vOther) {
  // Edge direction.
  const ex = verts[vB * 3] - verts[vA * 3];
  const ey = verts[vB * 3 + 1] - verts[vA * 3 + 1];
  const ez = verts[vB * 3 + 2] - verts[vA * 3 + 2];
  // Candidate offset perp = n × e (right-hand rule).
  let ox = normal[1] * ez - normal[2] * ey;
  let oy = normal[2] * ex - normal[0] * ez;
  let oz = normal[0] * ey - normal[1] * ex;
  // Pick sign so the dir points toward the third vertex.
  const tx = verts[vOther * 3]     - verts[vA * 3];
  const ty = verts[vOther * 3 + 1] - verts[vA * 3 + 1];
  const tz = verts[vOther * 3 + 2] - verts[vA * 3 + 2];
  if (ox * tx + oy * ty + oz * tz < 0) { ox = -ox; oy = -oy; oz = -oz; }
  const L = Math.hypot(ox, oy, oz);
  if (L < _EPS) return [0, 0, 0];
  return [ox / L, oy / L, oz / L];
}

// Replace v with vNew in tri triIdx of outIdx.
function _retri(outIdx, triIdx, v, vNew) {
  if (outIdx[triIdx * 3]     === v) outIdx[triIdx * 3]     = vNew;
  if (outIdx[triIdx * 3 + 1] === v) outIdx[triIdx * 3 + 1] = vNew;
  if (outIdx[triIdx * 3 + 2] === v) outIdx[triIdx * 3 + 2] = vNew;
}

// Real bevel-edges. Returns { ok, geometry, addedFaces } or { ok: false, error }.
export function bevelEdges(geometry, edgePairs, width) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) {
    return { ok: false, error: 'no geometry' };
  }
  if (!Array.isArray(edgePairs) || edgePairs.length === 0) {
    return { ok: false, error: 'edgePairs must be non-empty array' };
  }
  const w = Number(width);
  if (!Number.isFinite(w) || w <= 0) {
    return { ok: false, error: 'width must be > 0' };
  }
  const posAttr = geometry.attributes.position;
  const vertCount = posAttr.count;
  const verts = _vertsCopy(posAttr);
  const inIdx = _idxCopy(geometry, vertCount);
  const triCount = inIdx.length / 3;
  const outIdx = inIdx.slice();   // start as a writable copy; we mutate.

  const edgeMap = _buildEdgeFaceMap(inIdx, triCount);

  let beveled = 0;
  let skipped = 0;
  const errors = [];

  for (const pair of edgePairs) {
    if (!Array.isArray(pair) || pair.length < 2) { skipped++; continue; }
    const vA = pair[0] | 0, vB = pair[1] | 0;
    if (vA === vB || vA < 0 || vB < 0 || vA >= vertCount || vB >= vertCount) {
      skipped++; continue;
    }
    const k = _edgeKey(vA, vB);
    const faces = edgeMap.get(k);
    if (!faces || faces.length < 2) {
      // Boundary or non-edge — bevels need both wings.
      skipped++;
      errors.push(`edge ${vA}-${vB} not a manifold edge (faces=${faces ? faces.length : 0})`);
      continue;
    }

    const fa = faces[0], fb = faces[1];
    const otherA = _otherCorner(inIdx, fa, vA, vB);
    const otherB = _otherCorner(inIdx, fb, vA, vB);

    const nA = _triNormal(verts,
      inIdx[fa * 3], inIdx[fa * 3 + 1], inIdx[fa * 3 + 2]);
    const nB = _triNormal(verts,
      inIdx[fb * 3], inIdx[fb * 3 + 1], inIdx[fb * 3 + 2]);

    const offA = _wingOffsetDir(verts, nA, vA, vB, otherA);
    const offB = _wingOffsetDir(verts, nB, vA, vB, otherB);

    // Duplicate (vA, vB) for each wing, shifted by width along its offset.
    const aLeftIdx = verts.length / 3;
    verts.push(
      verts[vA * 3]     + offA[0] * w,
      verts[vA * 3 + 1] + offA[1] * w,
      verts[vA * 3 + 2] + offA[2] * w,
    );
    const bLeftIdx = verts.length / 3;
    verts.push(
      verts[vB * 3]     + offA[0] * w,
      verts[vB * 3 + 1] + offA[1] * w,
      verts[vB * 3 + 2] + offA[2] * w,
    );
    const aRightIdx = verts.length / 3;
    verts.push(
      verts[vA * 3]     + offB[0] * w,
      verts[vA * 3 + 1] + offB[1] * w,
      verts[vA * 3 + 2] + offB[2] * w,
    );
    const bRightIdx = verts.length / 3;
    verts.push(
      verts[vB * 3]     + offB[0] * w,
      verts[vB * 3 + 1] + offB[1] * w,
      verts[vB * 3 + 2] + offB[2] * w,
    );

    // Re-wire wing A to use (aLeft, bLeft); wing B to use (aRight, bRight).
    _retri(outIdx, fa, vA, aLeftIdx);
    _retri(outIdx, fa, vB, bLeftIdx);
    _retri(outIdx, fb, vA, aRightIdx);
    _retri(outIdx, fb, vB, bRightIdx);

    // Emit the bevel strip quad (two CCW tris) connecting the two new rims.
    // Order: aLeft → bLeft → bRight → aRight.
    outIdx.push(aLeftIdx, bLeftIdx, bRightIdx);
    outIdx.push(aLeftIdx, bRightIdx, aRightIdx);

    beveled++;
  }

  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const IdxCtor = outIdx.length > 65535
    ? THREE.Uint32BufferAttribute
    : THREE.Uint16BufferAttribute;
  newGeom.setIndex(new IdxCtor(outIdx, 1));
  newGeom.computeVertexNormals();
  newGeom.computeBoundingBox();
  newGeom.computeBoundingSphere();

  return {
    ok: true,
    geometry: newGeom,
    addedFaces: beveled * 2,   // each beveled edge adds one quad = 2 tris.
    beveled,
    skipped,
    errors,
  };
}

export default bevelEdges;
