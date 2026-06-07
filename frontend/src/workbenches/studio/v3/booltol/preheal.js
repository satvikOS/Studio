// ArchDisc Studio V3 — Parasolid-tier tolerant boolean PRE-HEALING
// (slice 781).
//
// Parasolid's "tolerant modelling" path runs a small healing pre-pass on
// every incoming body before booleans so that imported / stitched
// geometry from STEP / IGES / scanned meshes doesn't blow up the
// classifier with sub-tolerance gaps, slivers, or duplicate verts. The
// procedures below are the polygonal analogues of that pre-pass:
//
//   removeDuplicateVerts(geom, tol)   — spatial-hash weld at tol
//   fillSmallHoles(geom, maxArea)     — triangle-fan fill of boundary
//                                       loops below maxArea
//   removeSliverTris(geom, minRatio)  — drop degenerate triangles by
//                                       aspect-ratio (area / max-edge²)
//   mergeNearCoplanarFaces(geom,thr)  — collapse co-planar neighbour
//                                       triangles into shared planes
//                                       (info-only — returns face groups
//                                       for the downstream remesher)
//
// All functions take and return THREE.BufferGeometry; the input is NOT
// mutated — every function returns a fresh BufferGeometry so the caller
// can chain them or roll back individually.
//
// Pure JS, eval-free, NO new deps; only depends on three.js.

import * as THREE from 'three';

// ─── removeDuplicateVerts ──────────────────────────────────────────────
// Spatial-hash weld at ``tol``. Drops duplicate vertices whose bucket
// coordinates round to the same integer key, remaps the index buffer,
// and prunes any triangle that becomes degenerate (two indices equal).
//
// Returns a fresh indexed BufferGeometry with normals + bounds.
export function removeDuplicateVerts(geom, tol = 1e-6) {
  if (!geom || !geom.attributes || !geom.attributes.position) {
    throw new Error('removeDuplicateVerts: geom has no position attribute');
  }
  const eps = (typeof tol === 'number' && isFinite(tol) && tol > 0) ? tol : 1e-6;
  // Ensure indexed.
  const src = geom.index ? geom : geom.toNonIndexed();
  const srcPos = src.attributes.position;
  const srcIdx = src.index;
  const triCount = srcIdx ? (srcIdx.count / 3) | 0 : (srcPos.count / 3) | 0;

  const buckets = new Map();
  const remap = new Int32Array(srcPos.count);
  const newPos = [];
  for (let i = 0; i < srcPos.count; i++) {
    const x = srcPos.getX(i);
    const y = srcPos.getY(i);
    const z = srcPos.getZ(i);
    // Multiplying by 1/eps and flooring buckets coords; matches geomnodes2
    // mergeByDistance + qemdecim _meshToFlat.
    const key =
      `${Math.round(x / eps)}|${Math.round(y / eps)}|${Math.round(z / eps)}`;
    const hit = buckets.get(key);
    if (hit !== undefined) {
      remap[i] = hit;
    } else {
      const ni = newPos.length / 3;
      buckets.set(key, ni);
      newPos.push(x, y, z);
      remap[i] = ni;
    }
  }

  const newTris = [];
  let dropped = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = srcIdx ? srcIdx.getX(t * 3)     : t * 3;
    const i1 = srcIdx ? srcIdx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = srcIdx ? srcIdx.getX(t * 3 + 2) : t * 3 + 2;
    const a = remap[i0], b = remap[i1], c = remap[i2];
    if (a === b || b === c || a === c) { dropped++; continue; }
    newTris.push(a, b, c);
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
  out.setIndex(newTris);
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  // Stash diagnostics so the caller can report what changed without
  // re-walking the geometry.
  out.userData = out.userData || {};
  out.userData.archdiscStudioPreheal = Object.assign(
    out.userData.archdiscStudioPreheal || {},
    {
      removedDup: srcPos.count - (newPos.length / 3),
      droppedDegen: dropped,
      tol: eps,
    }
  );
  return out;
}

// ─── fillSmallHoles ────────────────────────────────────────────────────
// Detect boundary edges (used by exactly one triangle), walk them into
// closed loops, and fill each loop whose enclosing polygon area is below
// ``maxArea`` with a triangle fan around the centroid.
//
// This is the polygonal analogue of Parasolid's "stitch" / "fill_face"
// healing operations. We deliberately fan around the centroid rather
// than ear-clip — small holes (sliver gaps from import) are typically
// convex on the scale of `maxArea`, and the centroid fan is robust
// against non-planar boundary loops (the resulting triangles are still
// inside the bounding hull).
//
// Returns a fresh indexed BufferGeometry.
export function fillSmallHoles(geom, maxArea = 1e-4) {
  if (!geom || !geom.attributes || !geom.attributes.position) {
    throw new Error('fillSmallHoles: geom has no position attribute');
  }
  const src = geom.index ? geom : geom.toNonIndexed();
  const srcPos = src.attributes.position;
  const srcIdx = src.index;
  const triCount = srcIdx ? (srcIdx.count / 3) | 0 : (srcPos.count / 3) | 0;

  // Collect edges + their tri counts.
  const edgeCount = new Map(); // "a_b" (a<b) → count
  const edgeDir = new Map();   // "a_b" → [from, to] keyed by original direction so loops walk consistently
  function pushEdge(a, b) {
    const key = (a < b) ? `${a}_${b}` : `${b}_${a}`;
    edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
    // Record the FIRST seen direction; this is the triangle-winding
    // direction we'll walk later (boundary edges only ever appear once
    // so the recorded direction matches the half-edge).
    if (!edgeDir.has(key)) edgeDir.set(key, [a, b]);
  }
  for (let t = 0; t < triCount; t++) {
    const i0 = srcIdx ? srcIdx.getX(t * 3)     : t * 3;
    const i1 = srcIdx ? srcIdx.getX(t * 3 + 1) : t * 3 + 1;
    const i2 = srcIdx ? srcIdx.getX(t * 3 + 2) : t * 3 + 2;
    pushEdge(i0, i1);
    pushEdge(i1, i2);
    pushEdge(i2, i0);
  }

  // Boundary edges have count === 1.
  const adj = new Map(); // from → [to,...]
  for (const [key, count] of edgeCount.entries()) {
    if (count !== 1) continue;
    const dir = edgeDir.get(key);
    if (!dir) continue;
    const [a, b] = dir;
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push(b);
  }

  // Walk loops.
  const loops = [];
  const visited = new Set();
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    const loop = [];
    let cur = start;
    let safety = 0;
    while (cur !== undefined && !visited.has(cur) && safety++ < 1e6) {
      visited.add(cur);
      loop.push(cur);
      const next = adj.get(cur);
      if (!next || !next.length) break;
      const n = next.shift();
      cur = n;
      if (cur === start) break;
    }
    if (loop.length >= 3) loops.push(loop);
  }

  // Compute centroid + enclosed area for each loop, fill if small enough.
  const newTris = [];
  if (srcIdx) {
    for (let t = 0; t < triCount; t++) {
      newTris.push(srcIdx.getX(t * 3), srcIdx.getX(t * 3 + 1), srcIdx.getX(t * 3 + 2));
    }
  } else {
    for (let t = 0; t < triCount; t++) {
      newTris.push(t * 3, t * 3 + 1, t * 3 + 2);
    }
  }
  const newPos = [];
  for (let i = 0; i < srcPos.count; i++) {
    newPos.push(srcPos.getX(i), srcPos.getY(i), srcPos.getZ(i));
  }

  let filled = 0;
  const cap = (typeof maxArea === 'number' && isFinite(maxArea) && maxArea > 0)
    ? maxArea : 1e-4;
  for (const loop of loops) {
    // 3D polygon area via fan to its centroid — accurate for near-planar
    // loops, conservative for warped ones (sum of triangle areas).
    let cx = 0, cy = 0, cz = 0;
    for (const vi of loop) {
      cx += srcPos.getX(vi);
      cy += srcPos.getY(vi);
      cz += srcPos.getZ(vi);
    }
    cx /= loop.length; cy /= loop.length; cz /= loop.length;
    let area = 0;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      const ax = srcPos.getX(a) - cx, ay = srcPos.getY(a) - cy, az = srcPos.getZ(a) - cz;
      const bx = srcPos.getX(b) - cx, by = srcPos.getY(b) - cy, bz = srcPos.getZ(b) - cz;
      const cxn = ay * bz - az * by;
      const cyn = az * bx - ax * bz;
      const czn = ax * by - ay * bx;
      area += 0.5 * Math.sqrt(cxn * cxn + cyn * cyn + czn * czn);
    }
    if (area > cap) continue;
    // Fill the loop with a centroid fan. The edge direction recorded
    // above runs clockwise around the hole when looking from OUTSIDE the
    // mesh (boundary half-edge of an outward-facing tri) — so the
    // centroid-fan triangles need the reversed winding to face outward.
    const centroidIdx = newPos.length / 3;
    newPos.push(cx, cy, cz);
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i], b = loop[(i + 1) % loop.length];
      newTris.push(centroidIdx, b, a);
    }
    filled++;
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
  out.setIndex(newTris);
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  out.userData = out.userData || {};
  out.userData.archdiscStudioPreheal = Object.assign(
    out.userData.archdiscStudioPreheal || {},
    { boundaryLoops: loops.length, filledHoles: filled, maxArea: cap }
  );
  return out;
}

// ─── removeSliverTris ──────────────────────────────────────────────────
// Drop degenerate triangles by aspect ratio. A sliver triangle has area
// much smaller than its longest edge squared — we use
//
//    ratio = (2 * area) / (max_edge_length²)
//
// which equals 1 for an equilateral triangle, ~0.5 for a right
// isosceles, and approaches 0 for a sliver. ``minRatio`` defaults to
// 1e-6 — anything below is a near-zero-area degenerate.
//
// Returns a fresh indexed BufferGeometry.
export function removeSliverTris(geom, minRatio = 1e-6) {
  if (!geom || !geom.attributes || !geom.attributes.position) {
    throw new Error('removeSliverTris: geom has no position attribute');
  }
  const src = geom.index ? geom : geom.toNonIndexed();
  const srcPos = src.attributes.position;
  const srcIdx = src.index;
  const triCount = srcIdx ? (srcIdx.count / 3) | 0 : (srcPos.count / 3) | 0;
  const cap = (typeof minRatio === 'number' && isFinite(minRatio) && minRatio >= 0)
    ? minRatio : 1e-6;

  const newTris = [];
  let dropped = 0;
  for (let t = 0; t < triCount; t++) {
    const ia = srcIdx ? srcIdx.getX(t * 3)     : t * 3;
    const ib = srcIdx ? srcIdx.getX(t * 3 + 1) : t * 3 + 1;
    const ic = srcIdx ? srcIdx.getX(t * 3 + 2) : t * 3 + 2;
    const ax = srcPos.getX(ia), ay = srcPos.getY(ia), az = srcPos.getZ(ia);
    const bx = srcPos.getX(ib), by = srcPos.getY(ib), bz = srcPos.getZ(ib);
    const cx = srcPos.getX(ic), cy = srcPos.getY(ic), cz = srcPos.getZ(ic);
    // Edges
    const ab2 = (bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2;
    const bc2 = (cx - bx) ** 2 + (cy - by) ** 2 + (cz - bz) ** 2;
    const ca2 = (ax - cx) ** 2 + (ay - cy) ** 2 + (az - cz) ** 2;
    const maxE2 = Math.max(ab2, bc2, ca2);
    if (maxE2 <= 0) { dropped++; continue; } // co-located triangle
    // Twice the area via the cross product.
    const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const twoArea = Math.sqrt(nx * nx + ny * ny + nz * nz);
    const ratio = twoArea / maxE2;
    if (ratio < cap) { dropped++; continue; }
    newTris.push(ia, ib, ic);
  }

  // Keep all positions — don't prune unreferenced verts, that's the
  // welder's job. The result is still smaller because the index buffer
  // shrinks.
  const newPos = [];
  for (let i = 0; i < srcPos.count; i++) {
    newPos.push(srcPos.getX(i), srcPos.getY(i), srcPos.getZ(i));
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
  out.setIndex(newTris);
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  out.userData = out.userData || {};
  out.userData.archdiscStudioPreheal = Object.assign(
    out.userData.archdiscStudioPreheal || {},
    { droppedSlivers: dropped, minRatio: cap, beforeTris: triCount }
  );
  return out;
}

// ─── mergeNearCoplanarFaces ────────────────────────────────────────────
// Group triangles whose normals are within ``cosThreshold`` of each
// other AND whose plane-offset (dot(n, centroid)) is within
// ``offsetThreshold``. Returns the same geometry (cloned, not mutated)
// PLUS a userData payload describing the groups so the downstream
// re-mesher can collapse each group into a single face if it wants to.
//
// Polygonal CSG operates triangle-wise — there's no concept of a
// multi-tri "face" — but Parasolid's tolerant boolean uses this grouping
// to recognise the imported-as-many-tris planar face as a single planar
// face for coincident-face elimination. We surface the same grouping
// here so the downstream classifier can use it.
//
// cosThreshold defaults to cos(0.5°) ≈ 0.99996. offsetThreshold defaults
// to 1e-4.
export function mergeNearCoplanarFaces(geom, cosThreshold = 0.99996, offsetThreshold = 1e-4) {
  if (!geom || !geom.attributes || !geom.attributes.position) {
    throw new Error('mergeNearCoplanarFaces: geom has no position attribute');
  }
  const src = geom.index ? geom : geom.toNonIndexed();
  const srcPos = src.attributes.position;
  const srcIdx = src.index;
  const triCount = srcIdx ? (srcIdx.count / 3) | 0 : (srcPos.count / 3) | 0;

  const ct = (typeof cosThreshold === 'number') ? cosThreshold : 0.99996;
  const ot = (typeof offsetThreshold === 'number') ? offsetThreshold : 1e-4;

  // Per-tri normal + plane offset.
  const triN = new Float32Array(triCount * 3);
  const triD = new Float32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const ia = srcIdx ? srcIdx.getX(t * 3)     : t * 3;
    const ib = srcIdx ? srcIdx.getX(t * 3 + 1) : t * 3 + 1;
    const ic = srcIdx ? srcIdx.getX(t * 3 + 2) : t * 3 + 2;
    const ax = srcPos.getX(ia), ay = srcPos.getY(ia), az = srcPos.getZ(ia);
    const bx = srcPos.getX(ib), by = srcPos.getY(ib), bz = srcPos.getZ(ib);
    const cx = srcPos.getX(ic), cy = srcPos.getY(ic), cz = srcPos.getZ(ic);
    let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
    let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    const ln = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= ln; ny /= ln; nz /= ln;
    triN[t * 3]     = nx;
    triN[t * 3 + 1] = ny;
    triN[t * 3 + 2] = nz;
    // Plane offset = n · centroid
    const ccx = (ax + bx + cx) / 3;
    const ccy = (ay + by + cy) / 3;
    const ccz = (az + bz + cz) / 3;
    triD[t] = nx * ccx + ny * ccy + nz * ccz;
  }

  // Edge-adjacency map (tri index → neighbour tri indices via shared edges).
  const edgeOwner = new Map(); // "a_b" → tri index of first owner
  const adj = new Map();       // tri index → Set of neighbour tri indices
  function addAdj(a, b) {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b);
    adj.get(b).add(a);
  }
  function pushEdge(t, a, b) {
    const key = (a < b) ? `${a}_${b}` : `${b}_${a}`;
    const owner = edgeOwner.get(key);
    if (owner === undefined) edgeOwner.set(key, t);
    else addAdj(owner, t);
  }
  for (let t = 0; t < triCount; t++) {
    const ia = srcIdx ? srcIdx.getX(t * 3)     : t * 3;
    const ib = srcIdx ? srcIdx.getX(t * 3 + 1) : t * 3 + 1;
    const ic = srcIdx ? srcIdx.getX(t * 3 + 2) : t * 3 + 2;
    pushEdge(t, ia, ib);
    pushEdge(t, ib, ic);
    pushEdge(t, ic, ia);
  }

  // Flood-fill groups: tri starts a group; spread to neighbours whose
  // normal AND offset are within thresholds.
  const groupOf = new Int32Array(triCount).fill(-1);
  const groups = []; // [{ id, triIndices: [], n: [x,y,z], d }]
  for (let seed = 0; seed < triCount; seed++) {
    if (groupOf[seed] !== -1) continue;
    const gid = groups.length;
    const nx = triN[seed * 3], ny = triN[seed * 3 + 1], nz = triN[seed * 3 + 2];
    const d  = triD[seed];
    const tris = [];
    const queue = [seed];
    groupOf[seed] = gid;
    while (queue.length) {
      const t = queue.shift();
      tris.push(t);
      const nbrs = adj.get(t);
      if (!nbrs) continue;
      for (const n of nbrs) {
        if (groupOf[n] !== -1) continue;
        const dot = triN[n * 3] * nx + triN[n * 3 + 1] * ny + triN[n * 3 + 2] * nz;
        if (dot < ct) continue;
        if (Math.abs(triD[n] - d) > ot) continue;
        groupOf[n] = gid;
        queue.push(n);
      }
    }
    groups.push({ id: gid, triIndices: tris, n: [nx, ny, nz], d });
  }

  // Build the output geometry (a clone) with the grouping stamped on
  // userData. We DO NOT collapse tris — the polygonal CSG layer wants
  // per-tri faces. Groups are info for the classifier.
  const newPos = [];
  for (let i = 0; i < srcPos.count; i++) {
    newPos.push(srcPos.getX(i), srcPos.getY(i), srcPos.getZ(i));
  }
  const newTris = [];
  for (let t = 0; t < triCount; t++) {
    const ia = srcIdx ? srcIdx.getX(t * 3)     : t * 3;
    const ib = srcIdx ? srcIdx.getX(t * 3 + 1) : t * 3 + 1;
    const ic = srcIdx ? srcIdx.getX(t * 3 + 2) : t * 3 + 2;
    newTris.push(ia, ib, ic);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
  out.setIndex(newTris);
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  out.userData = out.userData || {};
  out.userData.archdiscStudioPreheal = Object.assign(
    out.userData.archdiscStudioPreheal || {},
    {
      coplanarGroups: groups.length,
      cosThreshold: ct,
      offsetThreshold: ot,
    }
  );
  out.userData.archdiscStudioCoplanarGroups = groups;
  return out;
}

// ─── Combined heal driver (public convenience) ─────────────────────────
// Runs the four passes in the order Parasolid's healer documents:
//   1. weld duplicate verts
//   2. drop slivers
//   3. fill small holes
//   4. group near-coplanar faces (info-only — downstream consumes it)
//
// Returns a fresh geometry whose userData.archdiscStudioPreheal carries
// the per-pass diagnostics merged. Convenient single entrypoint for
// callers that don't want to wire the chain themselves.
export function prehealGeometry(geom, opts = {}) {
  const o = opts || {};
  const tol         = (o.tol !== undefined) ? +o.tol : 1e-6;
  const sliverRatio = (o.sliverRatio !== undefined) ? +o.sliverRatio : 1e-6;
  const holeArea    = (o.holeArea !== undefined) ? +o.holeArea : 1e-4;
  const cosT        = (o.cosThreshold !== undefined) ? +o.cosThreshold : 0.99996;
  const offT        = (o.offsetThreshold !== undefined) ? +o.offsetThreshold : 1e-4;

  const a = removeDuplicateVerts(geom, tol);
  const b = removeSliverTris(a, sliverRatio);
  const c = fillSmallHoles(b, holeArea);
  const d = mergeNearCoplanarFaces(c, cosT, offT);

  // Free intermediates.
  try { a.dispose && a.dispose(); } catch (_) {}
  try { b.dispose && b.dispose(); } catch (_) {}
  try { c.dispose && c.dispose(); } catch (_) {}

  return d;
}
