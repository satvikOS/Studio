// SketchUp-style Push/Pull single-face extrude (slice 747).
//
// Real mesh surgery: pick a face, find the coplanar neighbour region
// (so a quad made of 2 triangles is one logical "face"), walk its
// boundary loop, duplicate the cap verts, push them along the face
// normal by `distance`, re-emit the cap with the duplicated indices,
// and build N real side quads along the boundary. The bottom face
// stays put; volume grows by exactly faceArea * distance.
//
// Three call shapes:
//   pushPullFace(mesh, faceIndex, distance)
//       → headless one-shot, the entry point used by the headless e2e
//         and by the cmd-palette `__studioPushPullFace` op.
//   beginPushPullSession(mesh, faceIndex)
//       → returns a handle holding pre-computed cap/side allocations
//         so the interactive drag can update O(capVerts) per frame.
//   applyPushPullDistance(handle, distance), commit/cancel
//
// Indexed BufferGeometry only. `mergeVertices`-like weld is required
// for non-indexed BoxGeometry (each "face" is otherwise 1 triangle).
// We do that inside `pushPullFace` so a fresh BoxGeometry "just works".

import * as THREE from 'three';

const ANGLE_EPS_DOT = 0.99996;   // ~0.5° coplanar tolerance

// Weld duplicate vertices within `tol` so coplanar-region detection
// finds neighbour triangles via shared indices. Returns either the
// original indexed BufferGeometry or a fresh welded one.
function _ensureIndexed(geom, tol = 1e-5) {
  if (geom.index && geom.attributes.position) return geom;
  const merged = THREE.BufferGeometryUtils
    ? THREE.BufferGeometryUtils.mergeVertices(geom, tol)
    : _mergeVerticesFallback(geom, tol);
  return merged;
}

// Minimal fallback if BufferGeometryUtils isn't in the bundle.
function _mergeVerticesFallback(geom, tol) {
  const pos = geom.attributes.position;
  if (!pos) return geom;
  const buckets = new Map();
  const out = [];
  const idx = [];
  for (let i = 0; i < pos.count; i++) {
    const x = Math.round(pos.getX(i) / tol);
    const y = Math.round(pos.getY(i) / tol);
    const z = Math.round(pos.getZ(i) / tol);
    const key = `${x}_${y}_${z}`;
    if (buckets.has(key)) {
      idx.push(buckets.get(key));
    } else {
      buckets.set(key, out.length / 3);
      out.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      idx.push(out.length / 3 - 1);
    }
  }
  const newGeom = new THREE.BufferGeometry();
  newGeom.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  newGeom.setIndex(idx);
  newGeom.computeVertexNormals();
  return newGeom;
}

function _triNormal(positions, i0, i1, i2) {
  const ax = positions[i0 * 3],     ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
  const bx = positions[i1 * 3],     by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
  const cx = positions[i2 * 3],     cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];
  const ex1 = bx - ax, ey1 = by - ay, ez1 = bz - az;
  const ex2 = cx - ax, ey2 = cy - ay, ez2 = cz - az;
  const nx = ey1 * ez2 - ez1 * ey2;
  const ny = ez1 * ex2 - ex1 * ez2;
  const nz = ex1 * ey2 - ey1 * ex2;
  const L = Math.hypot(nx, ny, nz) || 1;
  return [nx / L, ny / L, nz / L];
}

function _triArea(positions, i0, i1, i2) {
  const ax = positions[i0 * 3],     ay = positions[i0 * 3 + 1], az = positions[i0 * 3 + 2];
  const bx = positions[i1 * 3],     by = positions[i1 * 3 + 1], bz = positions[i1 * 3 + 2];
  const cx = positions[i2 * 3],     cy = positions[i2 * 3 + 1], cz = positions[i2 * 3 + 2];
  const ex1 = bx - ax, ey1 = by - ay, ez1 = bz - az;
  const ex2 = cx - ax, ey2 = cy - ay, ez2 = cz - az;
  return 0.5 * Math.hypot(
    ey1 * ez2 - ez1 * ey2,
    ez1 * ex2 - ex1 * ez2,
    ex1 * ey2 - ey1 * ex2,
  );
}

// BFS the coplanar region around `seedFaceIdx` over edge-shared
// neighbours whose face normal is within ANGLE_EPS_DOT of the seed.
// Returns { tris: number[] (indices into the triangle list), normal,
// area }.
function _findCoplanarRegion(index, positions, seedFaceIdx) {
  const triCount = index.length / 3;
  const seed = seedFaceIdx | 0;
  if (seed < 0 || seed >= triCount) return null;
  const a = index[seed * 3], b = index[seed * 3 + 1], c = index[seed * 3 + 2];
  const seedN = _triNormal(positions, a, b, c);

  // Build edge → triangle adjacency.
  const edgeMap = new Map();
  function _addEdge(u, v, t) {
    const k = u < v ? `${u}_${v}` : `${v}_${u}`;
    const arr = edgeMap.get(k);
    if (arr) arr.push(t); else edgeMap.set(k, [t]);
  }
  for (let t = 0; t < triCount; t++) {
    const i0 = index[t * 3], i1 = index[t * 3 + 1], i2 = index[t * 3 + 2];
    _addEdge(i0, i1, t); _addEdge(i1, i2, t); _addEdge(i2, i0, t);
  }

  const inRegion = new Set();
  const queue = [seed];
  inRegion.add(seed);
  while (queue.length) {
    const t = queue.shift();
    const i0 = index[t * 3], i1 = index[t * 3 + 1], i2 = index[t * 3 + 2];
    const edges = [[i0, i1], [i1, i2], [i2, i0]];
    for (const [u, v] of edges) {
      const k = u < v ? `${u}_${v}` : `${v}_${u}`;
      const ts = edgeMap.get(k) || [];
      for (const nt of ts) {
        if (inRegion.has(nt)) continue;
        const n = _triNormal(positions,
          index[nt * 3], index[nt * 3 + 1], index[nt * 3 + 2]);
        const d = n[0] * seedN[0] + n[1] * seedN[1] + n[2] * seedN[2];
        if (d >= ANGLE_EPS_DOT) { inRegion.add(nt); queue.push(nt); }
      }
    }
  }

  // Sum face area.
  let area = 0;
  for (const t of inRegion) {
    area += _triArea(positions,
      index[t * 3], index[t * 3 + 1], index[t * 3 + 2]);
  }
  return { tris: Array.from(inRegion), normal: seedN, area };
}

// Walk the boundary loop of the region. Returns vertices in order so
// the boundary winds CCW about the outward normal.
function _extractBoundaryLoop(region, index) {
  const inRegion = new Set(region.tris);
  // Edge usage counts inside the region — boundary = 1, interior = 2.
  const edgeUse = new Map(); // key → [u, v, useCount]
  function _bump(u, v) {
    const k = u < v ? `${u}_${v}` : `${v}_${u}`;
    const e = edgeUse.get(k);
    if (e) e[2]++;
    else edgeUse.set(k, [u, v, 1]);
  }
  for (const t of region.tris) {
    const i0 = index[t * 3], i1 = index[t * 3 + 1], i2 = index[t * 3 + 2];
    _bump(i0, i1); _bump(i1, i2); _bump(i2, i0);
  }
  const boundary = [];
  for (const [u, v, c] of edgeUse.values()) {
    if (c === 1) boundary.push([u, v]);
  }
  if (!boundary.length) return null;

  // For each boundary edge we know it appears in exactly one region
  // triangle. Find that triangle and emit the edge in the direction
  // matching that triangle's winding — this guarantees a consistent
  // CCW boundary about the seed normal.
  const directedEdges = boundary.map(([u, v]) => {
    for (const t of region.tris) {
      const i0 = index[t * 3], i1 = index[t * 3 + 1], i2 = index[t * 3 + 2];
      const tri = [i0, i1, i2];
      for (let k = 0; k < 3; k++) {
        const a = tri[k], b = tri[(k + 1) % 3];
        if ((a === u && b === v) || (a === v && b === u)) {
          return [a, b];
        }
      }
    }
    return [u, v];
  });

  // Chain edges into a single ring.
  const next = new Map();
  for (const [a, b] of directedEdges) next.set(a, b);
  if (!next.size) return null;
  const start = directedEdges[0][0];
  const ring = [start];
  let cur = next.get(start);
  while (cur !== undefined && cur !== start && ring.length < directedEdges.length + 1) {
    ring.push(cur);
    cur = next.get(cur);
  }
  return ring;
}

// One-shot push/pull. Returns the rebuilt mesh stats and the new
// cap/side face counts so the e2e and HUD can verify the surgery.
export function pushPullFace(mesh, seedFaceIdx, distance) {
  if (!mesh || !mesh.geometry) return { ok: false, error: 'no mesh.geometry' };
  if (!isFinite(distance)) return { ok: false, error: 'distance not finite' };

  // Step 1: ensure indexed + welded.
  let geo = mesh.geometry;
  if (!geo.index) geo = _ensureIndexed(geo);
  const indexArr = Array.from(geo.index.array);
  const posArr = Array.from(geo.attributes.position.array);

  // Step 2: coplanar region detection.
  const region = _findCoplanarRegion(indexArr, posArr, seedFaceIdx);
  if (!region || !region.tris.length) {
    return { ok: false, error: 'no coplanar region around face' };
  }
  const normal = region.normal;
  const faceArea = region.area;

  // Step 3: boundary loop.
  const loop = _extractBoundaryLoop(region, indexArr);
  if (!loop || loop.length < 3) {
    return { ok: false, error: 'failed to extract boundary loop' };
  }

  // Step 4: duplicate cap verts (every vertex used by any region tri).
  const capVerts = new Set();
  for (const t of region.tris) {
    capVerts.add(indexArr[t * 3]);
    capVerts.add(indexArr[t * 3 + 1]);
    capVerts.add(indexArr[t * 3 + 2]);
  }
  const capMap = new Map();   // oldIdx → newIdx
  const newPos = posArr.slice();
  for (const v of capVerts) {
    const newIdx = newPos.length / 3;
    capMap.set(v, newIdx);
    newPos.push(
      posArr[v * 3]     + normal[0] * distance,
      posArr[v * 3 + 1] + normal[1] * distance,
      posArr[v * 3 + 2] + normal[2] * distance,
    );
  }

  // Step 5: build the new index. Keep all non-region triangles, emit
  // cap triangles with capMap'd indices (preserving winding), then
  // emit two side triangles per boundary edge.
  const regionSet = new Set(region.tris);
  const newIndex = [];
  for (let t = 0; t < indexArr.length / 3; t++) {
    if (regionSet.has(t)) continue;
    newIndex.push(indexArr[t * 3], indexArr[t * 3 + 1], indexArr[t * 3 + 2]);
  }
  // Caps with the new indices, same winding.
  for (const t of region.tris) {
    const a = indexArr[t * 3], b = indexArr[t * 3 + 1], c = indexArr[t * 3 + 2];
    newIndex.push(capMap.get(a), capMap.get(b), capMap.get(c));
  }
  // Side quads.
  const sideStartIdx = newIndex.length / 3;
  for (let i = 0; i < loop.length; i++) {
    const u = loop[i];
    const v = loop[(i + 1) % loop.length];
    // For boundary edge (u → v), the side quad has corners u, v, cap(v),
    // cap(u). Two triangles wound to face OUTWARD from the region (the
    // cap moved along +normal, so side outward is the right-hand cross
    // of the edge direction and the normal).
    const cu = capMap.get(u);
    const cv = capMap.get(v);
    if (cu === undefined || cv === undefined) continue;
    newIndex.push(u, v, cv);
    newIndex.push(u, cv, cu);
  }
  const capStartIdx = (indexArr.length - region.tris.length * 3) / 3;
  const capEndIdx = capStartIdx + region.tris.length;

  // Step 6: assign the rebuilt geometry to the mesh.
  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
  newGeo.setIndex(newIndex);
  newGeo.computeVertexNormals();
  newGeo.computeBoundingSphere();
  newGeo.computeBoundingBox();
  // Preserve userData where applicable.
  if (mesh.geometry.userData) newGeo.userData = { ...mesh.geometry.userData };

  // Dispose the old geometry & swap (preserves material + transform).
  const oldGeo = mesh.geometry;
  mesh.geometry = newGeo;
  try { oldGeo.dispose && oldGeo.dispose(); } catch (_) {}

  // Stamp the surgery on the mesh.
  mesh.userData = mesh.userData || {};
  mesh.userData.archdiscStudioPushPulled =
    (mesh.userData.archdiscStudioPushPulled || 0) + 1;
  mesh.userData.archdiscStudioLastPushPull = {
    faceArea,
    distance,
    normal: [normal[0], normal[1], normal[2]],
    capTris: region.tris.length,
    sideTris: loop.length * 2,
  };

  return {
    ok: true,
    faceArea,
    distance,
    normal: [normal[0], normal[1], normal[2]],
    capTris: region.tris.length,
    sideTris: loop.length * 2,
    boundaryVerts: loop.length,
    totalTris: newIndex.length / 3,
    capStartIdx,
    capEndIdx,
    sideStartIdx,
  };
}

// Interactive session — same surgery split into begin/apply/commit so
// drag updates can mutate positions in place.
export function beginPushPullSession(mesh, seedFaceIdx) {
  if (!mesh || !mesh.geometry) return { ok: false, error: 'no mesh.geometry' };
  let geo = mesh.geometry;
  if (!geo.index) {
    const merged = _ensureIndexed(geo);
    geo = merged;
    mesh.geometry = merged;
  }
  const indexArr = Array.from(geo.index.array);
  const posArr = Array.from(geo.attributes.position.array);
  const region = _findCoplanarRegion(indexArr, posArr, seedFaceIdx);
  if (!region) return { ok: false, error: 'no coplanar region' };
  const loop = _extractBoundaryLoop(region, indexArr);
  if (!loop || loop.length < 3) return { ok: false, error: 'no boundary loop' };

  const capVerts = new Set();
  for (const t of region.tris) {
    capVerts.add(indexArr[t * 3]);
    capVerts.add(indexArr[t * 3 + 1]);
    capVerts.add(indexArr[t * 3 + 2]);
  }
  const capMap = new Map();
  const newPos = posArr.slice();
  const capIndices = [];
  for (const v of capVerts) {
    const newIdx = newPos.length / 3;
    capMap.set(v, newIdx);
    newPos.push(posArr[v * 3], posArr[v * 3 + 1], posArr[v * 3 + 2]);
    capIndices.push({ origIdx: v, newIdx });
  }

  const regionSet = new Set(region.tris);
  const newIndex = [];
  for (let t = 0; t < indexArr.length / 3; t++) {
    if (regionSet.has(t)) continue;
    newIndex.push(indexArr[t * 3], indexArr[t * 3 + 1], indexArr[t * 3 + 2]);
  }
  for (const t of region.tris) {
    const a = indexArr[t * 3], b = indexArr[t * 3 + 1], c = indexArr[t * 3 + 2];
    newIndex.push(capMap.get(a), capMap.get(b), capMap.get(c));
  }
  for (let i = 0; i < loop.length; i++) {
    const u = loop[i];
    const v = loop[(i + 1) % loop.length];
    const cu = capMap.get(u);
    const cv = capMap.get(v);
    if (cu === undefined || cv === undefined) continue;
    newIndex.push(u, v, cv);
    newIndex.push(u, cv, cu);
  }

  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(newPos, 3));
  newGeo.setIndex(newIndex);
  newGeo.computeVertexNormals();

  const oldGeo = mesh.geometry;
  mesh.geometry = newGeo;
  try { oldGeo.dispose && oldGeo.dispose(); } catch (_) {}

  return {
    ok: true,
    handle: {
      mesh, capIndices, origPositions: posArr, normal: region.normal,
      faceArea: region.area, distance: 0,
    },
  };
}

export function applyPushPullDistance(handle, distance) {
  if (!handle || !handle.mesh) return { ok: false };
  const { mesh, capIndices, origPositions, normal } = handle;
  const posAttr = mesh.geometry.attributes.position;
  for (const { origIdx, newIdx } of capIndices) {
    posAttr.setXYZ(newIdx,
      origPositions[origIdx * 3]     + normal[0] * distance,
      origPositions[origIdx * 3 + 1] + normal[1] * distance,
      origPositions[origIdx * 3 + 2] + normal[2] * distance,
    );
  }
  posAttr.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  try { mesh.geometry.computeBoundingSphere(); } catch (_) {}
  handle.distance = distance;
  return { ok: true, distance };
}

export function commitPushPullSession(handle) {
  if (!handle || !handle.mesh) return { ok: false };
  handle.mesh.userData = handle.mesh.userData || {};
  handle.mesh.userData.archdiscStudioPushPulled =
    (handle.mesh.userData.archdiscStudioPushPulled || 0) + 1;
  handle.mesh.userData.archdiscStudioLastPushPull = {
    faceArea: handle.faceArea,
    distance: handle.distance,
    normal: handle.normal.slice(),
  };
  return { ok: true, distance: handle.distance, faceArea: handle.faceArea };
}

export function cancelPushPullSession(handle) {
  if (!handle || !handle.mesh) return { ok: false };
  return applyPushPullDistance(handle, 0);
}
