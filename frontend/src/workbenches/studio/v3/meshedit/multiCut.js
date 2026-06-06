// ArchDisc Studio V3 — Maya MultiCut tool (slice 756).
//
// Maya's MultiCut is the polymesh interactive cut: pick a start vertex,
// pick an end vertex, and drag the cut LINE across the mesh. Every triangle
// the line crosses is split into two new tris around the cut, and a chain
// of new verts is inserted along the straight line between the two picks.
//
// Real algorithm — pure JS:
//   1. Take the straight 3-D line through (verts[startIdx]) → (verts[endIdx])
//      and divide it into `segments` equal parts. Each part endpoint is a
//      candidate new vert sitting EXACTLY on the line.
//   2. For each existing triangle: signed distance of each corner to the
//      line is computed (perpendicular distance to the line in the
//      tri-plane projection). If the cut line CROSSES the triangle —
//      i.e. one side has a sign change — we split the tri:
//        • find the two edges that the line crosses
//        • introduce intersection verts at those crossings
//        • emit two replacement tris around the cut
//
// Honest scope: works on triangulated meshes. The cut line is taken in
// mesh-local space (not unprojected from screen). For the polished
// `__studioMeshMultiCut` op, segments controls how many evenly-spaced
// new verts get inserted on the line; the verts get welded into any
// crossed edges they happen to coincide with (within EPS).

import * as THREE from 'three';

const _EPS = 1e-7;

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

// Return the parameter t ∈ [0,1] of the closest point on segment a→b to
// the infinite line through p1→p2, expressed via Plücker-style perpendicular
// projection. We use the implicit 3-D line distance test: the segment a→b
// crosses the line iff the signed perpendicular projections of a and b
// onto the plane through the line and (line direction × ab direction) have
// opposite signs.
//
// We use the simpler scheme: build a plane containing the line and the
// average tri normal, then segment a→b is intersected with that plane.
function _segmentPlaneIntersect(ax, ay, az, bx, by, bz, plane) {
  const A = plane[0] * ax + plane[1] * ay + plane[2] * az + plane[3];
  const B = plane[0] * bx + plane[1] * by + plane[2] * bz + plane[3];
  if ((A > 0 && B > 0) || (A < 0 && B < 0)) return null;
  if (Math.abs(A - B) < _EPS) return null;
  const t = A / (A - B);
  return { t, sa: A, sb: B };
}

// Build the cut plane through the line p1→p2 with a normal chosen to
// straddle the mesh: we orient the plane normal perpendicular to the line
// and to the AVERAGE per-tri normal across the mesh (so the cut is a
// vertical slab through the mesh containing the pick line). Returns
// [nx, ny, nz, d] where the plane equation is n·x + d = 0.
function _buildCutPlane(p1, p2, avgNormal) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1], dz = p2[2] - p1[2];
  // Plane normal = line direction × avg surface normal.
  let nx = dy * avgNormal[2] - dz * avgNormal[1];
  let ny = dz * avgNormal[0] - dx * avgNormal[2];
  let nz = dx * avgNormal[1] - dy * avgNormal[0];
  let L = Math.hypot(nx, ny, nz);
  if (L < _EPS) {
    // Line is parallel to average normal; pick ANY orthogonal direction.
    if (Math.abs(dx) < 0.5) { nx = 1; ny = 0; nz = 0; }
    else { nx = 0; ny = 1; nz = 0; }
    // Re-orthogonalize against the line direction.
    const ld = (nx * dx + ny * dy + nz * dz);
    nx -= ld * dx; ny -= ld * dy; nz -= ld * dz;
    L = Math.hypot(nx, ny, nz) || 1;
  }
  nx /= L; ny /= L; nz /= L;
  const d = -(nx * p1[0] + ny * p1[1] + nz * p1[2]);
  return [nx, ny, nz, d];
}

function _avgNormal(verts, idx) {
  let nx = 0, ny = 0, nz = 0;
  const tri = idx.length / 3;
  for (let f = 0; f < tri; f++) {
    const i0 = idx[f * 3], i1 = idx[f * 3 + 1], i2 = idx[f * 3 + 2];
    const ax = verts[i0 * 3],     ay = verts[i0 * 3 + 1], az = verts[i0 * 3 + 2];
    const bx = verts[i1 * 3],     by = verts[i1 * 3 + 1], bz = verts[i1 * 3 + 2];
    const cx = verts[i2 * 3],     cy = verts[i2 * 3 + 1], cz = verts[i2 * 3 + 2];
    const ex = bx - ax, ey = by - ay, ez = bz - az;
    const fx = cx - ax, fy = cy - ay, fz = cz - az;
    nx += ey * fz - ez * fy;
    ny += ez * fx - ex * fz;
    nz += ex * fy - ey * fx;
  }
  const L = Math.hypot(nx, ny, nz);
  if (L < _EPS) return [0, 1, 0];
  return [nx / L, ny / L, nz / L];
}

// Real MultiCut. Returns:
//   { ok, geometry, addedVerts, addedFaces, vertChain }
//   { ok: false, error }
//
// segments controls how many evenly-spaced new verts are EXPLICITLY
// inserted along the line p1→p2 (a Maya MultiCut "snap dots" feature).
// `segments` must be >= 1; segments=1 just inserts the endpoint verts
// (which already exist), so the meaningful range is segments >= 2.
export function multiCut(geometry, startIdx, endIdx, segments) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) {
    return { ok: false, error: 'no geometry' };
  }
  if (!Number.isInteger(startIdx) || !Number.isInteger(endIdx)) {
    return { ok: false, error: 'startIdx / endIdx must be integers' };
  }
  const posAttr = geometry.attributes.position;
  const vertCount = posAttr.count;
  if (startIdx < 0 || endIdx < 0 || startIdx >= vertCount || endIdx >= vertCount) {
    return { ok: false, error: 'vertex index out of range' };
  }
  if (startIdx === endIdx) {
    return { ok: false, error: 'start and end vertex are identical' };
  }
  const segCount = Math.max(1, Number(segments) | 0);
  const verts = _vertsCopy(posAttr);
  const inIdx = _idxCopy(geometry, vertCount);

  const p1 = [verts[startIdx * 3], verts[startIdx * 3 + 1], verts[startIdx * 3 + 2]];
  const p2 = [verts[endIdx * 3],   verts[endIdx * 3 + 1],   verts[endIdx * 3 + 2]];

  const avgN = _avgNormal(verts, inIdx);
  const plane = _buildCutPlane(p1, p2, avgN);

  // Insert the segment-chain verts along p1→p2 (intermediate points only).
  // segments=N → N-1 intermediate verts ( vertChain length = N+1 with both
  // endpoints, but startIdx/endIdx are the existing verts so we add N-1 ).
  const vertChain = [startIdx];
  let addedVerts = 0;
  for (let s = 1; s < segCount; s++) {
    const t = s / segCount;
    const x = p1[0] + (p2[0] - p1[0]) * t;
    const y = p1[1] + (p2[1] - p1[1]) * t;
    const z = p1[2] + (p2[2] - p1[2]) * t;
    const newIdx = verts.length / 3;
    verts.push(x, y, z);
    vertChain.push(newIdx);
    addedVerts++;
  }
  vertChain.push(endIdx);

  // Walk triangles and split any crossed by the cut plane.
  const triCount = inIdx.length / 3;
  const outIdx = [];
  let addedFaces = 0;

  // Reuse a small cache so identical edge-crossings don't create dupes.
  const edgeCache = new Map();
  const edgeKey = (u, v) => (u < v) ? `${u}_${v}` : `${v}_${u}`;
  function _insertOrCacheCrossing(i0, i1, t) {
    const k = edgeKey(i0, i1);
    if (edgeCache.has(k)) return edgeCache.get(k);
    const x = verts[i0 * 3]     + (verts[i1 * 3]     - verts[i0 * 3])     * t;
    const y = verts[i0 * 3 + 1] + (verts[i1 * 3 + 1] - verts[i0 * 3 + 1]) * t;
    const z = verts[i0 * 3 + 2] + (verts[i1 * 3 + 2] - verts[i0 * 3 + 2]) * t;
    const idx = verts.length / 3;
    verts.push(x, y, z);
    addedVerts++;
    edgeCache.set(k, idx);
    return idx;
  }

  for (let f = 0; f < triCount; f++) {
    const ia = inIdx[f * 3], ib = inIdx[f * 3 + 1], ic = inIdx[f * 3 + 2];
    const ax = verts[ia * 3], ay = verts[ia * 3 + 1], az = verts[ia * 3 + 2];
    const bx = verts[ib * 3], by = verts[ib * 3 + 1], bz = verts[ib * 3 + 2];
    const cx = verts[ic * 3], cy = verts[ic * 3 + 1], cz = verts[ic * 3 + 2];

    const sa = plane[0] * ax + plane[1] * ay + plane[2] * az + plane[3];
    const sb = plane[0] * bx + plane[1] * by + plane[2] * bz + plane[3];
    const sc = plane[0] * cx + plane[1] * cy + plane[2] * cz + plane[3];

    const posSide = (sa > _EPS ? 1 : 0) + (sb > _EPS ? 1 : 0) + (sc > _EPS ? 1 : 0);
    const negSide = (sa < -_EPS ? 1 : 0) + (sb < -_EPS ? 1 : 0) + (sc < -_EPS ? 1 : 0);

    if (posSide === 0 || negSide === 0) {
      // Triangle entirely on one side of the cut plane — keep as-is.
      outIdx.push(ia, ib, ic);
      continue;
    }

    // Find the lone vertex on its own side.
    let apex, p, q;
    if ((sa > 0) === (sb > 0)) { apex = ic; p = ia; q = ib; }
    else if ((sa > 0) === (sc > 0)) { apex = ib; p = ic; q = ia; }
    else { apex = ia; p = ib; q = ic; }

    const tP = _segmentPlaneIntersect(
      verts[apex * 3], verts[apex * 3 + 1], verts[apex * 3 + 2],
      verts[p * 3],    verts[p * 3 + 1],    verts[p * 3 + 2],
      plane,
    );
    const tQ = _segmentPlaneIntersect(
      verts[apex * 3], verts[apex * 3 + 1], verts[apex * 3 + 2],
      verts[q * 3],    verts[q * 3 + 1],    verts[q * 3 + 2],
      plane,
    );
    if (!tP || !tQ) { outIdx.push(ia, ib, ic); continue; }
    const newP = _insertOrCacheCrossing(apex, p, tP.t);
    const newQ = _insertOrCacheCrossing(apex, q, tQ.t);

    // Three sub-triangles per Blender's k-split: (apex, newP, newQ),
    // (newP, p, q), (newP, q, newQ). This is the same scheme editKnife uses.
    outIdx.push(apex, newP, newQ);
    outIdx.push(newP, p,    q);
    outIdx.push(newP, q,    newQ);
    addedFaces += 2;  // tri count goes from 1 → 3.
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
    addedVerts,
    addedFaces,
    vertChain,
  };
}

export default multiCut;
