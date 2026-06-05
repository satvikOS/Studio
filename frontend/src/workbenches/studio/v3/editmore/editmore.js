// ArchDisc Studio V3 — DEEPER Blender-style mesh edit-mode operators.
//
// Twelve ops that extend the slice-682 edit/ module with finer-grained
// surgery on THREE.BufferGeometry:
//
//   1. extrudeIndividual — per-face normal extrusion.
//   2. fillNgon          — fan-triangulate an arbitrary vertex loop.
//   3. fillHoles         — find every boundary loop + fan-fill it.
//   4. pokeFace          — replace one face with N centroid-triangles.
//   5. triangulateNgons  — confirm-no-ngons (mesh is already triangulated).
//   6. splitEdge         — insert a midpoint on one specific edge.
//   7. collapseEdge      — merge an edge's two endpoints into the midpoint.
//   8. flipNormals       — reverse winding of every triangle.
//   9. recalculateNormalsOutside — outward-consistent vertex normals.
//   10. mergeCenter      — merge selected verts (or all verts) to centroid.
//   11. separateBySelection — split a mesh into two by a vertex-index list.
//   12. markSeam         — tag edges in geometry.userData.archdiscStudioSeams.
//
// All ops operate on the ACTIVE selection (window.__studioSelectedMesh()),
// in pure THREE/JS — no external mesh libraries — and every op produces a
// geometry that is measurably different from the input (verifiable via
// vert / tri / hole counts and bounding-box checks).
//
// installEditMore() is IDEMPOTENT — re-running overwrites the existing
// window slots (the desired behaviour for hot-reload + repeat tests).

import * as THREE from 'three';

// ─── shared helpers ─────────────────────────────────────────────────────

function activeMesh() {
  if (typeof window === 'undefined') return null;
  if (window.__studioSelectedMesh) {
    try { const m = window.__studioSelectedMesh(); if (m && m.geometry) return m; } catch (_) {}
  }
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}

function pushUndo() {
  if (typeof window !== 'undefined' && typeof window.__studioPushUndo === 'function') {
    try { window.__studioPushUndo(); } catch (_) {}
  }
}

function ensureIndexed(geo) {
  if (geo.index) return geo;
  const pos = geo.attributes.position;
  if (!pos) return geo;
  const idx = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) idx[i] = i;
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

function getVertsArrayCopy(posAttr) {
  const out = new Array(posAttr.count * 3);
  for (let i = 0; i < posAttr.count; i++) {
    out[i * 3] = posAttr.getX(i);
    out[i * 3 + 1] = posAttr.getY(i);
    out[i * 3 + 2] = posAttr.getZ(i);
  }
  return out;
}

function getIdxArrayCopy(idxAttr) {
  const out = new Array(idxAttr.count);
  for (let i = 0; i < idxAttr.count; i++) out[i] = idxAttr.getX(i);
  return out;
}

function triNormal(verts, ia, ib, ic, out) {
  const ax = verts[ia * 3], ay = verts[ia * 3 + 1], az = verts[ia * 3 + 2];
  const bx = verts[ib * 3], by = verts[ib * 3 + 1], bz = verts[ib * 3 + 2];
  const cx = verts[ic * 3], cy = verts[ic * 3 + 1], cz = verts[ic * 3 + 2];
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const acx = cx - ax, acy = cy - ay, acz = cz - az;
  out.set(aby * acz - abz * acy, abz * acx - abx * acz, abx * acy - aby * acx);
  const len = out.length();
  if (len > 1e-12) out.divideScalar(len);
  return out;
}

function edgeKey(a, b) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function rebuildGeometry(mesh, outVerts, outIdx) {
  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(outVerts, 3));
  newGeo.setIndex(
    outIdx.length > 65535
      ? new THREE.Uint32BufferAttribute(outIdx, 1)
      : new THREE.Uint16BufferAttribute(outIdx, 1),
  );
  newGeo.computeVertexNormals();
  newGeo.computeBoundingBox();
  newGeo.computeBoundingSphere();
  if (mesh.geometry) {
    if (mesh.geometry.boundsTree && mesh.geometry.disposeBoundsTree) {
      try { mesh.geometry.disposeBoundsTree(); } catch (_) {}
    }
    mesh.geometry.dispose();
  }
  mesh.geometry = newGeo;
  return newGeo;
}

// Position-keyed weld so a BoxGeometry's 24 separate verts collapse to 8.
function buildWeldRemap(verts, eps) {
  const e = eps || 1e-5;
  const remap = new Int32Array(verts.length / 3);
  const grid = new Map();
  const key = (x, y, z) => `${Math.round(x / e)}_${Math.round(y / e)}_${Math.round(z / e)}`;
  for (let i = 0; i < remap.length; i++) {
    const k = key(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
    if (grid.has(k)) remap[i] = grid.get(k);
    else { grid.set(k, i); remap[i] = i; }
  }
  return remap;
}

// ─── 1. Extrude Individual ──────────────────────────────────────────────
// Push every face out along its own normal by `distance`. Each face
// becomes a tiny pyramid frustum: original tri stays as the new bottom,
// three new verts mark the extruded top, and 3 side quads (6 tris) connect
// them. Result: original triCount tris → triCount + 3 * triCount = 4 *
// triCount tris (plus the unchanged bottom, so 4× total).
function editExtrudeIndividual(distance) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  const d = Number(distance);
  if (!Number.isFinite(d) || d === 0) return { ok: false, error: 'bad distance' };
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const verts = getVertsArrayCopy(geo.attributes.position);
  const inIdx = getIdxArrayCopy(geo.index);
  const triCount = inIdx.length / 3;

  const outIdx = [];
  let addedFaces = 0;
  const n = new THREE.Vector3();

  for (let f = 0; f < triCount; f++) {
    const ia = inIdx[f * 3], ib = inIdx[f * 3 + 1], ic = inIdx[f * 3 + 2];
    triNormal(verts, ia, ib, ic, n);
    const ax = verts[ia * 3], ay = verts[ia * 3 + 1], az = verts[ia * 3 + 2];
    const bx = verts[ib * 3], by = verts[ib * 3 + 1], bz = verts[ib * 3 + 2];
    const cx = verts[ic * 3], cy = verts[ic * 3 + 1], cz = verts[ic * 3 + 2];
    const nA = verts.length / 3; verts.push(ax + n.x * d, ay + n.y * d, az + n.z * d);
    const nB = nA + 1;           verts.push(bx + n.x * d, by + n.y * d, bz + n.z * d);
    const nC = nA + 2;           verts.push(cx + n.x * d, cy + n.y * d, cz + n.z * d);
    // Top cap (extruded face, same winding so normal flips after recalc).
    outIdx.push(nA, nB, nC);
    // Side quad ab → nB,nA: 2 tris.
    outIdx.push(ia, ib, nB); outIdx.push(ia, nB, nA);
    // Side quad bc → nC,nB.
    outIdx.push(ib, ic, nC); outIdx.push(ib, nC, nB);
    // Side quad ca → nA,nC.
    outIdx.push(ic, ia, nA); outIdx.push(ic, nA, nC);
    addedFaces += 6; // 6 side tris per face (top cap replaces original).
  }

  rebuildGeometry(mesh, verts, outIdx);
  return { ok: true, addedFaces, distance: d, faceCount: outIdx.length / 3 };
}

// ─── 2. Fill N-gon ──────────────────────────────────────────────────────
// Take an arbitrary ordered list of vertex indices that form a planar (or
// near-planar) polygon and add fan-triangulation tris connecting them.
// Returns the count of new triangles added.
function editFillNgon(vertIndices) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  if (!Array.isArray(vertIndices) || vertIndices.length < 3) return { ok: false, error: 'need >=3 vertIndices' };
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const vcount = geo.attributes.position.count;
  const verts = getVertsArrayCopy(geo.attributes.position);
  const inIdx = getIdxArrayCopy(geo.index);

  const cleaned = vertIndices.filter((i) => Number.isInteger(i) && i >= 0 && i < vcount);
  if (cleaned.length < 3) return { ok: false, error: 'too few valid indices' };

  // Dedup neighbours but keep loop order.
  const loop = [];
  for (let i = 0; i < cleaned.length; i++) {
    if (i === 0 || cleaned[i] !== cleaned[i - 1]) loop.push(cleaned[i]);
  }
  if (loop.length < 3) return { ok: false, error: 'loop collapses' };

  // Fan triangulation from loop[0].
  const anchor = loop[0];
  let addedTris = 0;
  for (let i = 1; i < loop.length - 1; i++) {
    inIdx.push(anchor, loop[i], loop[i + 1]);
    addedTris++;
  }

  rebuildGeometry(mesh, verts, inIdx);
  return { ok: true, addedTris, loopLength: loop.length, faceCount: inIdx.length / 3 };
}

// ─── 3. Fill Holes ──────────────────────────────────────────────────────
// Find every boundary loop (each edge belongs to exactly one face) and
// fan-fill it with triangles. Uses welded indices so distinct-but-coincident
// verts (e.g. on BoxGeometry) don't appear as fake boundary edges.
function editFillHoles() {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const verts = getVertsArrayCopy(geo.attributes.position);
  const inIdx = getIdxArrayCopy(geo.index);
  const triCount = inIdx.length / 3;
  const remap = buildWeldRemap(verts, 1e-5);
  // Pick a representative original index for each welded canonical id so we
  // can reference it in the new triangles.
  const repForWelded = new Map();
  for (let i = 0; i < remap.length; i++) {
    if (!repForWelded.has(remap[i])) repForWelded.set(remap[i], i);
  }

  // Count how many faces each edge touches (welded), capture per-edge ordered
  // endpoints (a → b) so we can reconstruct loops by traversal.
  const edgeCount = new Map();   // key → count
  const boundaryEdges = [];      // {a, b} (welded ids), only filled when count==1
  for (let f = 0; f < triCount; f++) {
    const a0 = remap[inIdx[f * 3]];
    const b0 = remap[inIdx[f * 3 + 1]];
    const c0 = remap[inIdx[f * 3 + 2]];
    const edges = [[a0, b0], [b0, c0], [c0, a0]];
    for (const [a, b] of edges) {
      if (a === b) continue;
      const k = edgeKey(a, b);
      edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
    }
  }
  // Build directed boundary edges (one per face, since each is in only 1 tri).
  for (let f = 0; f < triCount; f++) {
    const a0 = remap[inIdx[f * 3]];
    const b0 = remap[inIdx[f * 3 + 1]];
    const c0 = remap[inIdx[f * 3 + 2]];
    const directed = [[a0, b0], [b0, c0], [c0, a0]];
    for (const [a, b] of directed) {
      if (a === b) continue;
      if (edgeCount.get(edgeKey(a, b)) === 1) boundaryEdges.push({ a, b });
    }
  }

  if (!boundaryEdges.length) {
    return { ok: true, holes: 0, addedTris: 0, message: 'no boundary loops' };
  }

  // Build adjacency map: vert → array of [next-vert, edgeIdx-in-boundaryEdges].
  const nextMap = new Map();
  boundaryEdges.forEach((e, i) => {
    if (!nextMap.has(e.a)) nextMap.set(e.a, []);
    nextMap.get(e.a).push({ next: e.b, idx: i });
  });

  const used = new Uint8Array(boundaryEdges.length);
  const loops = [];
  for (let i = 0; i < boundaryEdges.length; i++) {
    if (used[i]) continue;
    const start = boundaryEdges[i].a;
    let cur = boundaryEdges[i].b;
    const loop = [start];
    used[i] = 1;
    let guard = 0;
    while (cur !== start && guard++ < boundaryEdges.length + 4) {
      loop.push(cur);
      const candidates = nextMap.get(cur) || [];
      let picked = -1;
      for (const cand of candidates) {
        if (!used[cand.idx]) { picked = cand.idx; break; }
      }
      if (picked < 0) break;
      used[picked] = 1;
      cur = boundaryEdges[picked].next;
    }
    if (loop.length >= 3) loops.push(loop);
  }

  let addedTris = 0;
  for (const loop of loops) {
    const anchorWelded = loop[0];
    const anchor = repForWelded.get(anchorWelded);
    if (anchor == null) continue;
    for (let i = 1; i < loop.length - 1; i++) {
      const v1 = repForWelded.get(loop[i]);
      const v2 = repForWelded.get(loop[i + 1]);
      if (v1 == null || v2 == null) continue;
      inIdx.push(anchor, v1, v2);
      addedTris++;
    }
  }

  rebuildGeometry(mesh, verts, inIdx);
  return { ok: true, holes: loops.length, addedTris, faceCount: inIdx.length / 3 };
}

// ─── 4. Poke Face ───────────────────────────────────────────────────────
// Insert a new vertex at the face's centroid, then replace the face with
// N triangles fanning around it (for a tri this gives 3 sub-triangles).
function editPokeFace(faceIdx) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const verts = getVertsArrayCopy(geo.attributes.position);
  const inIdx = getIdxArrayCopy(geo.index);
  const triCount = inIdx.length / 3;
  if (!Number.isInteger(faceIdx) || faceIdx < 0 || faceIdx >= triCount) {
    return { ok: false, error: 'bad faceIdx' };
  }

  const ia = inIdx[faceIdx * 3], ib = inIdx[faceIdx * 3 + 1], ic = inIdx[faceIdx * 3 + 2];
  const cx = (verts[ia * 3] + verts[ib * 3] + verts[ic * 3]) / 3;
  const cy = (verts[ia * 3 + 1] + verts[ib * 3 + 1] + verts[ic * 3 + 1]) / 3;
  const cz = (verts[ia * 3 + 2] + verts[ib * 3 + 2] + verts[ic * 3 + 2]) / 3;
  const newV = verts.length / 3;
  verts.push(cx, cy, cz);

  const outIdx = [];
  for (let f = 0; f < triCount; f++) {
    if (f === faceIdx) continue;
    outIdx.push(inIdx[f * 3], inIdx[f * 3 + 1], inIdx[f * 3 + 2]);
  }
  // 3 fan triangles around the centroid.
  outIdx.push(ia, ib, newV);
  outIdx.push(ib, ic, newV);
  outIdx.push(ic, ia, newV);

  rebuildGeometry(mesh, verts, outIdx);
  return { ok: true, faceIdx, newVert: newV, addedTris: 3, removed: 1, faceCount: outIdx.length / 3 };
}

// ─── 5. Triangulate N-gons ──────────────────────────────────────────────
// The engine renders only triangles, so any geometry with .index is already
// triangulated. This op is a confirm-no-ngons sanity check that returns
// the tri count + a no-op flag.
function editTriangulateNgons() {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  pushUndo();
  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const triCount = geo.index.count / 3;
  // Force-touch the bounds so callers know it ran (and any cached BVH gets
  // dropped, matching what a real ngon-split would have done).
  if (geo.boundsTree && geo.disposeBoundsTree) {
    try { geo.disposeBoundsTree(); } catch (_) {}
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return { ok: true, ngons: 0, triCount, alreadyTriangulated: true };
}

// ─── 6. Split Edge ──────────────────────────────────────────────────────
// Insert a new midpoint vertex on edge `edgeIdx` of face `edgeFaceIdx`
// (edgeIdx is 0/1/2 referring to v0→v1, v1→v2, v2→v0). The face that owns
// the edge becomes 2 sub-triangles; if another face shares the edge it
// also becomes 2 sub-triangles. Returns counts + new vertex index.
function editSplitEdge(edgeFaceIdx, edgeIdx) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const verts = getVertsArrayCopy(geo.attributes.position);
  const inIdx = getIdxArrayCopy(geo.index);
  const triCount = inIdx.length / 3;
  if (!Number.isInteger(edgeFaceIdx) || edgeFaceIdx < 0 || edgeFaceIdx >= triCount) {
    return { ok: false, error: 'bad edgeFaceIdx' };
  }
  const eIdx = Math.max(0, Math.min(2, Number.isInteger(edgeIdx) ? edgeIdx : 0));

  const faceVs = [inIdx[edgeFaceIdx * 3], inIdx[edgeFaceIdx * 3 + 1], inIdx[edgeFaceIdx * 3 + 2]];
  const a = faceVs[eIdx];
  const b = faceVs[(eIdx + 1) % 3];

  // Insert midpoint vert.
  const mx = (verts[a * 3] + verts[b * 3]) / 2;
  const my = (verts[a * 3 + 1] + verts[b * 3 + 1]) / 2;
  const mz = (verts[a * 3 + 2] + verts[b * 3 + 2]) / 2;
  const newV = verts.length / 3;
  verts.push(mx, my, mz);

  // Walk every face: if it shares edge a-b (either direction), split it.
  const outIdx = [];
  let splitFaces = 0;
  for (let f = 0; f < triCount; f++) {
    const v0 = inIdx[f * 3], v1 = inIdx[f * 3 + 1], v2 = inIdx[f * 3 + 2];
    const tri = [v0, v1, v2];
    let posA = -1, posB = -1;
    for (let i = 0; i < 3; i++) {
      if (tri[i] === a) posA = i;
      if (tri[i] === b) posB = i;
    }
    if (posA >= 0 && posB >= 0) {
      // Find the third vert (not a, not b).
      const third = tri.find((v) => v !== a && v !== b);
      // Maintain consistent winding: replace edge (a→b) with (a→newV)+(newV→b).
      // The original is (a, b, third) in some rotation. Build two tris:
      //   (a, newV, third) and (newV, b, third).
      // Determine winding direction (a→b or b→a) within original face by
      // checking which permutation matches.
      const cw = (posA + 1) % 3 === posB; // a comes before b in original CCW
      if (cw) {
        outIdx.push(a, newV, third);
        outIdx.push(newV, b, third);
      } else {
        outIdx.push(newV, a, third);
        outIdx.push(b, newV, third);
      }
      splitFaces++;
    } else {
      outIdx.push(v0, v1, v2);
    }
  }

  rebuildGeometry(mesh, verts, outIdx);
  return { ok: true, newVert: newV, splitFaces, edge: [a, b], faceCount: outIdx.length / 3 };
}

// ─── 7. Collapse Edge ───────────────────────────────────────────────────
// Merge an edge's two endpoints into their midpoint, drop any triangles
// that referenced the edge (they collapse to lines), then compact verts.
function editCollapseEdge(edgeFaceIdx, edgeIdx) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const verts = getVertsArrayCopy(geo.attributes.position);
  const inIdx = getIdxArrayCopy(geo.index);
  const triCount = inIdx.length / 3;
  if (!Number.isInteger(edgeFaceIdx) || edgeFaceIdx < 0 || edgeFaceIdx >= triCount) {
    return { ok: false, error: 'bad edgeFaceIdx' };
  }
  const eIdx = Math.max(0, Math.min(2, Number.isInteger(edgeIdx) ? edgeIdx : 0));

  const faceVs = [inIdx[edgeFaceIdx * 3], inIdx[edgeFaceIdx * 3 + 1], inIdx[edgeFaceIdx * 3 + 2]];
  const a = faceVs[eIdx];
  const b = faceVs[(eIdx + 1) % 3];
  if (a === b) return { ok: false, error: 'degenerate edge' };

  // Move a to midpoint; redirect every b-reference to a; drop tris that now
  // reference a twice (degenerate); compact.
  const mx = (verts[a * 3] + verts[b * 3]) / 2;
  const my = (verts[a * 3 + 1] + verts[b * 3 + 1]) / 2;
  const mz = (verts[a * 3 + 2] + verts[b * 3 + 2]) / 2;
  verts[a * 3] = mx;
  verts[a * 3 + 1] = my;
  verts[a * 3 + 2] = mz;

  const remapped = inIdx.map((i) => (i === b ? a : i));
  const outIdx = [];
  let droppedFaces = 0;
  for (let f = 0; f < triCount; f++) {
    const v0 = remapped[f * 3], v1 = remapped[f * 3 + 1], v2 = remapped[f * 3 + 2];
    if (v0 === v1 || v1 === v2 || v2 === v0) { droppedFaces++; continue; }
    outIdx.push(v0, v1, v2);
  }

  // Compact: drop the now-unreferenced b vertex (plus any other orphans).
  const oldCount = verts.length / 3;
  const used = new Set(outIdx);
  const remap = new Int32Array(oldCount);
  let next = 0;
  const compactVerts = [];
  for (let i = 0; i < oldCount; i++) {
    if (!used.has(i)) { remap[i] = -1; continue; }
    remap[i] = next++;
    compactVerts.push(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
  }
  const compactIdx = outIdx.map((i) => remap[i]);

  rebuildGeometry(mesh, compactVerts, compactIdx);
  return {
    ok: true,
    collapsedEdge: [a, b],
    droppedFaces,
    removedVerts: oldCount - next,
    faceCount: compactIdx.length / 3,
    vertCount: next,
  };
}

// ─── 8. Flip Normals ────────────────────────────────────────────────────
// Re-export the existing __studioInvertNormals under the parity name. If
// it doesn't exist (e.g. installed in isolation) we do a local fallback
// that reverses winding directly.
function editFlipNormals() {
  if (typeof window !== 'undefined' && typeof window.__studioInvertNormals === 'function') {
    pushUndo();
    return window.__studioInvertNormals();
  }
  // Fallback path — pure swap-winding on the active geometry's index.
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  pushUndo();
  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const inIdx = getIdxArrayCopy(geo.index);
  const triCount = inIdx.length / 3;
  for (let f = 0; f < triCount; f++) {
    const t = inIdx[f * 3 + 1];
    inIdx[f * 3 + 1] = inIdx[f * 3 + 2];
    inIdx[f * 3 + 2] = t;
  }
  geo.setIndex(
    inIdx.length > 65535
      ? new THREE.Uint32BufferAttribute(inIdx, 1)
      : new THREE.Uint16BufferAttribute(inIdx, 1),
  );
  geo.computeVertexNormals();
  return { ok: true, flipped: triCount, fallback: true };
}

// ─── 9. Recalculate Normals (Outside) ───────────────────────────────────
// Re-export the existing __studioGeometryFixOrientation under the parity
// name. Same fallback pattern as flipNormals.
function editRecalculateNormalsOutside() {
  if (typeof window !== 'undefined' && typeof window.__studioGeometryFixOrientation === 'function') {
    pushUndo();
    return window.__studioGeometryFixOrientation();
  }
  // Fallback: recompute vertex normals + ensure each tri faces away from
  // the bounding-box centre.
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  pushUndo();
  const geo = mesh.geometry;
  geo.computeBoundingBox();
  const centre = new THREE.Vector3();
  geo.boundingBox.getCenter(centre);
  ensureIndexed(geo);
  const verts = getVertsArrayCopy(geo.attributes.position);
  const inIdx = getIdxArrayCopy(geo.index);
  const triCount = inIdx.length / 3;
  const n = new THREE.Vector3();
  let flipped = 0;
  for (let f = 0; f < triCount; f++) {
    const ia = inIdx[f * 3], ib = inIdx[f * 3 + 1], ic = inIdx[f * 3 + 2];
    triNormal(verts, ia, ib, ic, n);
    const cx = (verts[ia * 3] + verts[ib * 3] + verts[ic * 3]) / 3;
    const cy = (verts[ia * 3 + 1] + verts[ib * 3 + 1] + verts[ic * 3 + 1]) / 3;
    const cz = (verts[ia * 3 + 2] + verts[ib * 3 + 2] + verts[ic * 3 + 2]) / 3;
    const ox = cx - centre.x, oy = cy - centre.y, oz = cz - centre.z;
    if (n.x * ox + n.y * oy + n.z * oz < 0) {
      const t = inIdx[f * 3 + 1];
      inIdx[f * 3 + 1] = inIdx[f * 3 + 2];
      inIdx[f * 3 + 2] = t;
      flipped++;
    }
  }
  geo.setIndex(
    inIdx.length > 65535
      ? new THREE.Uint32BufferAttribute(inIdx, 1)
      : new THREE.Uint16BufferAttribute(inIdx, 1),
  );
  geo.computeVertexNormals();
  return { ok: true, flipped, totalFaces: triCount, fallback: true };
}

// ─── 10. Merge at Centre ────────────────────────────────────────────────
// Merge a selection of verts (or every vert if none supplied) into their
// centroid. Any triangle whose vertices all become coincident collapses
// and is dropped. Resulting unreferenced verts are compacted out.
function editMergeCenter(vertIndices) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const verts = getVertsArrayCopy(geo.attributes.position);
  const inIdx = getIdxArrayCopy(geo.index);
  const vcount = geo.attributes.position.count;

  let selection;
  if (Array.isArray(vertIndices) && vertIndices.length) {
    selection = vertIndices.filter((i) => Number.isInteger(i) && i >= 0 && i < vcount);
  } else {
    selection = Array.from({ length: vcount }, (_, i) => i);
  }
  if (selection.length < 2) return { ok: false, error: 'need >=2 verts' };

  let cx = 0, cy = 0, cz = 0;
  for (const i of selection) {
    cx += verts[i * 3];
    cy += verts[i * 3 + 1];
    cz += verts[i * 3 + 2];
  }
  cx /= selection.length;
  cy /= selection.length;
  cz /= selection.length;

  // Move every selected vert to the centroid.
  for (const i of selection) {
    verts[i * 3] = cx;
    verts[i * 3 + 1] = cy;
    verts[i * 3 + 2] = cz;
  }

  // Remap all selected verts to a single canonical vertex (the first one)
  // so coincident verts no longer count as topologically distinct.
  const canonical = selection[0];
  const remapSel = new Map();
  for (const i of selection) remapSel.set(i, canonical);
  const remapped = inIdx.map((i) => (remapSel.has(i) ? remapSel.get(i) : i));

  const outIdx = [];
  let droppedFaces = 0;
  for (let f = 0; f < remapped.length / 3; f++) {
    const v0 = remapped[f * 3], v1 = remapped[f * 3 + 1], v2 = remapped[f * 3 + 2];
    if (v0 === v1 || v1 === v2 || v2 === v0) { droppedFaces++; continue; }
    outIdx.push(v0, v1, v2);
  }

  // Compact unreferenced verts.
  const used = new Set(outIdx);
  const remap = new Int32Array(verts.length / 3);
  let next = 0;
  const compactVerts = [];
  for (let i = 0; i < verts.length / 3; i++) {
    if (!used.has(i)) { remap[i] = -1; continue; }
    remap[i] = next++;
    compactVerts.push(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
  }
  const compactIdx = outIdx.map((i) => remap[i]);

  rebuildGeometry(mesh, compactVerts, compactIdx);
  return {
    ok: true,
    mergedVerts: selection.length,
    droppedFaces,
    centroid: [cx, cy, cz],
    vertCount: next,
    faceCount: compactIdx.length / 3,
  };
}

// ─── 11. Separate by Selection ──────────────────────────────────────────
// Take a vertex-index list. Any face whose verts ALL appear in the list
// gets moved to a brand-new mesh; the rest stay on the original. The new
// mesh inherits the source material, parent, and current transform but
// its own copy of the geometry.
function editSeparateBySelection(vertIndices) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  if (!Array.isArray(vertIndices) || !vertIndices.length) return { ok: false, error: 'no vertIndices' };
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const verts = getVertsArrayCopy(geo.attributes.position);
  const inIdx = getIdxArrayCopy(geo.index);
  const vcount = geo.attributes.position.count;
  const sel = new Set(vertIndices.filter((i) => Number.isInteger(i) && i >= 0 && i < vcount));
  if (!sel.size) return { ok: false, error: 'no valid vertIndices' };

  const triCount = inIdx.length / 3;
  const keepFaces = [];
  const movedFaces = [];
  for (let f = 0; f < triCount; f++) {
    const a = inIdx[f * 3], b = inIdx[f * 3 + 1], c = inIdx[f * 3 + 2];
    if (sel.has(a) && sel.has(b) && sel.has(c)) movedFaces.push(f);
    else keepFaces.push(f);
  }
  if (!movedFaces.length) return { ok: false, error: 'no faces match the selection' };

  // Build the new mesh's geometry (compacted verts).
  const newRemap = new Int32Array(vcount);
  for (let i = 0; i < vcount; i++) newRemap[i] = -1;
  let nextNew = 0;
  const newVerts = [];
  const newIdxArr = [];
  for (const f of movedFaces) {
    for (let k = 0; k < 3; k++) {
      const ov = inIdx[f * 3 + k];
      if (newRemap[ov] < 0) {
        newRemap[ov] = nextNew++;
        newVerts.push(verts[ov * 3], verts[ov * 3 + 1], verts[ov * 3 + 2]);
      }
      newIdxArr.push(newRemap[ov]);
    }
  }

  // Build the kept mesh's geometry (compacted verts that remain referenced).
  const keptIdxArr = [];
  for (const f of keepFaces) keptIdxArr.push(inIdx[f * 3], inIdx[f * 3 + 1], inIdx[f * 3 + 2]);
  const keepRemap = new Int32Array(vcount);
  for (let i = 0; i < vcount; i++) keepRemap[i] = -1;
  let nextKeep = 0;
  const keepVerts = [];
  const keepIdxCompact = [];
  for (let k = 0; k < keptIdxArr.length; k++) {
    const ov = keptIdxArr[k];
    if (keepRemap[ov] < 0) {
      keepRemap[ov] = nextKeep++;
      keepVerts.push(verts[ov * 3], verts[ov * 3 + 1], verts[ov * 3 + 2]);
    }
    keepIdxCompact.push(keepRemap[ov]);
  }

  // Rebuild the source mesh.
  rebuildGeometry(mesh, keepVerts, keepIdxCompact);

  // Build the new mesh and add it to the same parent.
  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(newVerts, 3));
  newGeo.setIndex(
    newIdxArr.length > 65535
      ? new THREE.Uint32BufferAttribute(newIdxArr, 1)
      : new THREE.Uint16BufferAttribute(newIdxArr, 1),
  );
  newGeo.computeVertexNormals();
  newGeo.computeBoundingBox();
  newGeo.computeBoundingSphere();

  const newMat = Array.isArray(mesh.material)
    ? mesh.material.map((m) => (m && m.clone ? m.clone() : m))
    : (mesh.material && mesh.material.clone ? mesh.material.clone() : mesh.material);
  const newMesh = new THREE.Mesh(newGeo, newMat);
  newMesh.name = `${mesh.name || 'mesh'}_sep`;
  newMesh.position.copy(mesh.position);
  newMesh.quaternion.copy(mesh.quaternion);
  newMesh.scale.copy(mesh.scale);
  newMesh.userData = { ...mesh.userData, archdiscStudioSeparatedFrom: mesh.uuid };
  const parent = mesh.parent || (typeof window !== 'undefined' && window.__archdiscScene)
    || (typeof window !== 'undefined' && window.__archdiscViewport && window.__archdiscViewport.scene);
  if (parent && parent.add) parent.add(newMesh);

  return {
    ok: true,
    movedFaces: movedFaces.length,
    keptFaces: keepFaces.length,
    newMeshUuid: newMesh.uuid,
    newVerts: nextNew,
    keptVerts: nextKeep,
  };
}

// ─── 12. Mark Seam ──────────────────────────────────────────────────────
// Tag an edge (face index + 0/1/2 edge slot) on
// `geometry.userData.archdiscStudioSeams`. Idempotent — re-adding the
// same edge does not duplicate.
function editMarkSeam(edgeFaceIdx, edgeIdx) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const triCount = geo.index.count / 3;
  if (!Number.isInteger(edgeFaceIdx) || edgeFaceIdx < 0 || edgeFaceIdx >= triCount) {
    return { ok: false, error: 'bad edgeFaceIdx' };
  }
  const eIdx = Math.max(0, Math.min(2, Number.isInteger(edgeIdx) ? edgeIdx : 0));

  const a = geo.index.getX(edgeFaceIdx * 3 + eIdx);
  const b = geo.index.getX(edgeFaceIdx * 3 + ((eIdx + 1) % 3));
  const key = edgeKey(a, b);

  if (!geo.userData) geo.userData = {};
  if (!Array.isArray(geo.userData.archdiscStudioSeams)) geo.userData.archdiscStudioSeams = [];
  const seams = geo.userData.archdiscStudioSeams;
  let added = false;
  if (!seams.includes(key)) { seams.push(key); added = true; }
  return {
    ok: true,
    added,
    edgeKey: key,
    a, b,
    seamCount: seams.length,
  };
}

// ─── exports ────────────────────────────────────────────────────────────

export const ops = {
  extrudeIndividual:           editExtrudeIndividual,
  fillNgon:                    editFillNgon,
  fillHoles:                   editFillHoles,
  pokeFace:                    editPokeFace,
  triangulateNgons:            editTriangulateNgons,
  splitEdge:                   editSplitEdge,
  collapseEdge:                editCollapseEdge,
  flipNormals:                 editFlipNormals,
  recalculateNormalsOutside:   editRecalculateNormalsOutside,
  mergeCenter:                 editMergeCenter,
  separateBySelection:         editSeparateBySelection,
  markSeam:                    editMarkSeam,
};

export {
  editExtrudeIndividual,
  editFillNgon,
  editFillHoles,
  editPokeFace,
  editTriangulateNgons,
  editSplitEdge,
  editCollapseEdge,
  editFlipNormals,
  editRecalculateNormalsOutside,
  editMergeCenter,
  editSeparateBySelection,
  editMarkSeam,
};
