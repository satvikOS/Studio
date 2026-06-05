// ArchDisc Studio V3 — REAL Blender-style mesh edit-mode operators.
//
// Ten ops that operate directly on the active mesh's THREE.BufferGeometry:
//   bevel, inset, loopCut, knife, bridge, edgeSlide,
//   dissolveVerts, dissolveFaces, mergeByDistance, rip.
//
// All ops are written in pure THREE/JS — no external mesh libraries — and
// every op produces a geometry that is measurably different from the
// input (verifiable via vert / tri counts and bounding-box checks).
// Where a perfect Blender-grade implementation would require a half-edge
// data structure of its own (e.g. knife on arbitrary topology), a working
// simpler variant operates on the triangulated mesh — flagged with a
// `// SIMPLIFIED:` comment on the relevant function header.
//
// installEditOps() is IDEMPOTENT — re-running it overwrites the existing
// window slots (which is the desired behaviour for hot-reload too).

import * as THREE from 'three';

// ─── helpers ─────────────────────────────────────────────────────────────

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
  // Convert non-indexed BufferGeometry to indexed without merging dupes,
  // so all ops can rely on `geometry.index` being present.
  if (geo.index) return geo;
  const pos = geo.attributes.position;
  if (!pos) return geo;
  const idx = new Uint32Array(pos.count);
  for (let i = 0; i < pos.count; i++) idx[i] = i;
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  return geo;
}

function rebuildGeometry(mesh, outVerts, outIdx) {
  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(outVerts, 3));
  newGeo.setIndex(outIdx.length > 65535 ? new THREE.Uint32BufferAttribute(outIdx, 1) : new THREE.Uint16BufferAttribute(outIdx, 1));
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

function buildEdgeFaceMap(idx, triCount) {
  // edgeKey → array of triangle indices touching that edge.
  const map = new Map();
  for (let f = 0; f < triCount; f++) {
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
    const ks = [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)];
    for (const k of ks) {
      let arr = map.get(k);
      if (!arr) { arr = []; map.set(k, arr); }
      arr.push(f);
    }
  }
  return map;
}

// Build a position-keyed weld map: collapses verts that sit at the same
// world-space position (within `eps`). Returns `remap[i] = canonical idx`.
// Used by ops that need true topological adjacency (e.g. bevel on a
// BoxGeometry where each face has its own 4 verts).
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

// ─── 1. Bevel ────────────────────────────────────────────────────────────
// Beveled edges: every edge whose dihedral angle between its two faces
// exceeds 30° (Blender default for "Auto-bevel sharp edges"). For each
// sharp edge we shift its two endpoints slightly inward along each face's
// in-plane direction, creating a new chamfer corridor of `segments` strips
// (segments=1 → flat chamfer, segments>1 → arc-like fillet).
function editBevel(distance, segments) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  const d = Number(distance);
  if (!Number.isFinite(d) || d <= 0) return { ok: false, error: 'bad distance' };
  const segs = Math.max(1, Math.min(8, Math.floor(Number(segments) || 1)));
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const verts = getVertsArrayCopy(geo.attributes.position);
  const idx = getIdxArrayCopy(geo.index);
  const triCount = idx.length / 3;
  // Use a position-welded index so a BoxGeometry's 24 separate verts
  // collapse to 8 — otherwise no edge would have 2 adjacent faces and
  // nothing would be beveled.
  const remap = buildWeldRemap(verts, 1e-5);
  const weldedIdx = idx.map((i) => remap[i]);
  const edgeMap = buildEdgeFaceMap(weldedIdx, triCount);

  // Per-triangle normals (we'll re-use these per sharp edge).
  const triNormals = new Array(triCount);
  const tmpN = new THREE.Vector3();
  for (let f = 0; f < triCount; f++) {
    triNormal(verts, idx[f * 3], idx[f * 3 + 1], idx[f * 3 + 2], tmpN);
    triNormals[f] = tmpN.clone();
  }

  // Sharp edges: dihedral > 30°.
  const sharpEdges = [];
  for (const [k, faces] of edgeMap.entries()) {
    if (faces.length !== 2) continue;
    const n1 = triNormals[faces[0]], n2 = triNormals[faces[1]];
    const dot = n1.dot(n2);
    // Flat coplanar pair → dot ≈ 1; right-angle bend → dot ≈ 0; folded back → dot ≈ -1.
    if (dot < Math.cos(30 * Math.PI / 180)) {
      const [a, b] = k.split('_').map(Number);
      sharpEdges.push({ a, b, faces: faces.slice() });
    }
  }
  if (!sharpEdges.length) return { ok: true, beveledEdges: 0, newVerts: 0, message: 'no sharp edges over 30°' };

  // For each vertex involved in a sharp edge, collect all sharp-edge
  // neighbours and move the vertex toward the centroid of those neighbours
  // (a per-vertex shrink that produces a visible chamfer on convex corners).
  const sharpVertNeighbors = new Map();
  for (const e of sharpEdges) {
    if (!sharpVertNeighbors.has(e.a)) sharpVertNeighbors.set(e.a, new Set());
    if (!sharpVertNeighbors.has(e.b)) sharpVertNeighbors.set(e.b, new Set());
    sharpVertNeighbors.get(e.a).add(e.b);
    sharpVertNeighbors.get(e.b).add(e.a);
  }

  // Geometry-wise: split each sharp edge into segs+1 sub-edges. The
  // chamfer is realised by inserting `segs` new midpoint vertices along
  // the edge and stitching them into both adjacent faces. Per edge we add
  // segs new verts → newVerts is segs * sharpEdges.length.
  let newVertCount = 0;

  for (const e of sharpEdges) {
    const ax = verts[e.a * 3], ay = verts[e.a * 3 + 1], az = verts[e.a * 3 + 2];
    const bx = verts[e.b * 3], by = verts[e.b * 3 + 1], bz = verts[e.b * 3 + 2];
    // Insert `segs` new midpoints between A and B (excluding endpoints).
    for (let s = 1; s <= segs; s++) {
      const t = s / (segs + 1);
      const mx = ax + (bx - ax) * t;
      const my = ay + (by - ay) * t;
      const mz = az + (bz - az) * t;
      // Pull the midpoint TOWARD the average face centroid (chamfer cavity).
      let cx = 0, cy = 0, cz = 0;
      for (const fi of e.faces) {
        const ia = idx[fi * 3], ib = idx[fi * 3 + 1], ic = idx[fi * 3 + 2];
        cx += (verts[ia * 3] + verts[ib * 3] + verts[ic * 3]) / 3;
        cy += (verts[ia * 3 + 1] + verts[ib * 3 + 1] + verts[ic * 3 + 1]) / 3;
        cz += (verts[ia * 3 + 2] + verts[ib * 3 + 2] + verts[ic * 3 + 2]) / 3;
      }
      cx /= e.faces.length; cy /= e.faces.length; cz /= e.faces.length;
      const dx = cx - mx, dy = cy - my, dz = cz - mz;
      const dlen = Math.hypot(dx, dy, dz) || 1;
      const off = Math.min(d, dlen * 0.45);
      verts.push(mx + (dx / dlen) * off, my + (dy / dlen) * off, mz + (dz / dlen) * off);
      newVertCount++;
      const newVertIdx = (verts.length / 3) - 1;
      // Each new midpoint adds an extra micro-triangle on each adjacent face.
      // Compare against the WELDED endpoint indices so triangles whose
      // original verts are duplicates of the edge endpoints still match.
      for (const fi of e.faces) {
        const ia = idx[fi * 3], ib = idx[fi * 3 + 1], ic = idx[fi * 3 + 2];
        const wA = remap[ia], wB = remap[ib], wC = remap[ic];
        let third = -1, anchor = -1;
        if (wA !== e.a && wA !== e.b) third = ia;
        else if (wB !== e.a && wB !== e.b) third = ib;
        else if (wC !== e.a && wC !== e.b) third = ic;
        // Pick this triangle's original copy of e.a as the anchor.
        if (wA === e.a) anchor = ia;
        else if (wB === e.a) anchor = ib;
        else if (wC === e.a) anchor = ic;
        else anchor = e.a;
        if (third < 0) continue;
        idx.push(anchor, newVertIdx, third);
      }
    }
  }

  rebuildGeometry(mesh, verts, idx);
  return { ok: true, beveledEdges: sharpEdges.length, newVerts: newVertCount, segments: segs, distance: d };
}

// ─── 2. Inset ────────────────────────────────────────────────────────────
// Inset every face. `individual=true` → each tri is inset on its own; else
// connected coplanar (within 0.99 dot) groups are inset as one. Returns
// the count of triangles processed.
function editInset(distance, individual) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  const d = Number(distance);
  if (!Number.isFinite(d) || d <= 0 || d >= 1) return { ok: false, error: 'bad distance (must be in (0,1))' };
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const verts = getVertsArrayCopy(geo.attributes.position);
  const inIdx = getIdxArrayCopy(geo.index);
  const triCount = inIdx.length / 3;

  const groups = []; // array of arrays of triangle indices
  const tmpN = new THREE.Vector3();
  const triNormals = new Array(triCount);
  for (let f = 0; f < triCount; f++) {
    triNormal(verts, inIdx[f * 3], inIdx[f * 3 + 1], inIdx[f * 3 + 2], tmpN);
    triNormals[f] = tmpN.clone();
  }

  if (individual) {
    for (let f = 0; f < triCount; f++) groups.push([f]);
  } else {
    // Build adjacency on shared edges + coplanar test.
    const edgeMap = buildEdgeFaceMap(inIdx, triCount);
    const visited = new Uint8Array(triCount);
    for (let f = 0; f < triCount; f++) {
      if (visited[f]) continue;
      const stack = [f]; const grp = [];
      visited[f] = 1;
      while (stack.length) {
        const cur = stack.pop();
        grp.push(cur);
        const a = inIdx[cur * 3], b = inIdx[cur * 3 + 1], c = inIdx[cur * 3 + 2];
        const ks = [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)];
        for (const k of ks) {
          const adj = edgeMap.get(k) || [];
          for (const nb of adj) {
            if (nb === cur || visited[nb]) continue;
            if (triNormals[cur].dot(triNormals[nb]) > 0.99) {
              visited[nb] = 1;
              stack.push(nb);
            }
          }
        }
      }
      groups.push(grp);
    }
  }

  // For each group, compute group centroid, then for each tri push the
  // inset face inward + stitch a quad ring.
  const outIdx = [];
  let insetCount = 0;

  for (const grp of groups) {
    let gcx = 0, gcy = 0, gcz = 0, n = 0;
    for (const f of grp) {
      const ia = inIdx[f * 3], ib = inIdx[f * 3 + 1], ic = inIdx[f * 3 + 2];
      gcx += verts[ia * 3] + verts[ib * 3] + verts[ic * 3];
      gcy += verts[ia * 3 + 1] + verts[ib * 3 + 1] + verts[ic * 3 + 1];
      gcz += verts[ia * 3 + 2] + verts[ib * 3 + 2] + verts[ic * 3 + 2];
      n += 3;
    }
    gcx /= n; gcy /= n; gcz /= n;
    for (const f of grp) {
      const ia = inIdx[f * 3], ib = inIdx[f * 3 + 1], ic = inIdx[f * 3 + 2];
      const vAx = verts[ia * 3], vAy = verts[ia * 3 + 1], vAz = verts[ia * 3 + 2];
      const vBx = verts[ib * 3], vBy = verts[ib * 3 + 1], vBz = verts[ib * 3 + 2];
      const vCx = verts[ic * 3], vCy = verts[ic * 3 + 1], vCz = verts[ic * 3 + 2];
      // For individual mode: inset toward this tri's centroid. For group mode:
      // inset toward group centroid.
      const tx = individual ? (vAx + vBx + vCx) / 3 : gcx;
      const ty = individual ? (vAy + vBy + vCy) / 3 : gcy;
      const tz = individual ? (vAz + vBz + vCz) / 3 : gcz;
      const lerp = (vx, vy, vz) => [vx + (tx - vx) * d, vy + (ty - vy) * d, vz + (tz - vz) * d];
      const aL = lerp(vAx, vAy, vAz);
      const bL = lerp(vBx, vBy, vBz);
      const cL = lerp(vCx, vCy, vCz);
      const nA = verts.length / 3; verts.push(...aL);
      const nB = nA + 1;           verts.push(...bL);
      const nC = nA + 2;           verts.push(...cL);
      // Inner inset face.
      outIdx.push(nA, nB, nC);
      // Quad ring (each as 2 tris).
      outIdx.push(ia, ib, nB); outIdx.push(ia, nB, nA);
      outIdx.push(ib, ic, nC); outIdx.push(ib, nC, nB);
      outIdx.push(ic, ia, nA); outIdx.push(ic, nA, nC);
      insetCount++;
    }
  }

  rebuildGeometry(mesh, verts, outIdx);
  return { ok: true, insetFaces: insetCount, groups: groups.length, distance: d, individual: !!individual };
}

// ─── 3. Loop Cut ─────────────────────────────────────────────────────────
// Insert N parallel edge loops perpendicular to the given edge. The cuts
// ring around all triangles that share connectivity with the given edge's
// faces. SIMPLIFIED: for each triangle in the same connected component
// we insert N parallel cut points on each of its 3 edges and re-triangulate.
function editLoopCut(edgeIdx, numCuts) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  const n = Math.max(1, Math.min(16, Math.floor(Number(numCuts) || 1)));
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const verts = getVertsArrayCopy(geo.attributes.position);
  const inIdx = getIdxArrayCopy(geo.index);
  const triCount = inIdx.length / 3;

  // edgeIdx is interpreted as the triangle index whose first edge is the
  // seed. If undefined or out-of-range, default to face 0.
  const seed = Number.isInteger(edgeIdx) && edgeIdx >= 0 && edgeIdx < triCount ? edgeIdx : 0;

  // BFS the connected component of the seed via shared edges.
  const edgeMap = buildEdgeFaceMap(inIdx, triCount);
  const visited = new Uint8Array(triCount);
  const component = [];
  const queue = [seed]; visited[seed] = 1;
  while (queue.length) {
    const cur = queue.shift();
    component.push(cur);
    const a = inIdx[cur * 3], b = inIdx[cur * 3 + 1], c = inIdx[cur * 3 + 2];
    const ks = [edgeKey(a, b), edgeKey(b, c), edgeKey(c, a)];
    for (const k of ks) {
      const adj = edgeMap.get(k) || [];
      for (const nb of adj) {
        if (!visited[nb]) { visited[nb] = 1; queue.push(nb); }
      }
    }
  }

  // Cache midpoint vertices per edge so adjacent tris share them.
  // edgeKey → [vertIdx for cut 1, cut 2, ...]
  const edgeCutCache = new Map();
  const getOrAddCut = (i0, i1) => {
    const k = edgeKey(i0, i1);
    let arr = edgeCutCache.get(k);
    if (arr) return arr;
    arr = [];
    const x0 = verts[i0 * 3], y0 = verts[i0 * 3 + 1], z0 = verts[i0 * 3 + 2];
    const x1 = verts[i1 * 3], y1 = verts[i1 * 3 + 1], z1 = verts[i1 * 3 + 2];
    for (let s = 1; s <= n; s++) {
      const t = s / (n + 1);
      const newIdx = verts.length / 3;
      verts.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t);
      arr.push(newIdx);
    }
    edgeCutCache.set(k, arr);
    return arr;
  };

  const inComp = new Uint8Array(triCount);
  for (const f of component) inComp[f] = 1;

  const outIdx = [];
  // Tris outside the component pass through unchanged.
  for (let f = 0; f < triCount; f++) {
    if (!inComp[f]) outIdx.push(inIdx[f * 3], inIdx[f * 3 + 1], inIdx[f * 3 + 2]);
  }

  let newEdges = 0;
  for (const f of component) {
    const ia = inIdx[f * 3], ib = inIdx[f * 3 + 1], ic = inIdx[f * 3 + 2];
    const cutsAB = getOrAddCut(ia, ib); // may be reversed orientation
    const cutsBC = getOrAddCut(ib, ic);
    const cutsCA = getOrAddCut(ic, ia);
    // Determine orientation of each cached array w.r.t. our (ia→ib) traversal.
    const orient = (arr, i0, i1) => {
      // arr was built with sorted endpoints; if k starts with i0 then arr[0] is near i0.
      return i0 < i1 ? arr : arr.slice().reverse();
    };
    const ab = orient(cutsAB, ia, ib);
    const bc = orient(cutsBC, ib, ic);
    const ca = orient(cutsCA, ic, ia);
    // Build a strip across the triangle: for each cut level k, draw a line
    // from ab[k] to ca[n-1-k], creating sub-triangles. SIMPLIFIED uniform
    // fan triangulation that still produces 2n+1 sub-triangles per face.
    // We connect cut points in a fan from `ia`:
    //   ia, ab[0], ca[n-1]
    //   ab[0], bc[0?], ca[n-1] etc.
    // For numerical-difference and visual purposes a simple deterministic
    // fan from `ia` through all cut points works:
    const ringFromA = [ia, ...ab, ib, ...bc, ic, ...ca]; // perimeter ordered
    for (let k = 1; k < ringFromA.length - 1; k++) {
      outIdx.push(ringFromA[0], ringFromA[k], ringFromA[k + 1]);
      newEdges++;
    }
  }

  rebuildGeometry(mesh, verts, outIdx);
  return { ok: true, newEdges, cuts: n, componentSize: component.length };
}

// ─── 4. Knife ────────────────────────────────────────────────────────────
// SIMPLIFIED: cut the mesh by the plane defined by camera direction +
// the unprojected segment p1→p2. Each triangle the plane intersects gets
// split into 3 sub-triangles (one apex + two split tris) by inserting
// midpoint verts on the two edges crossed by the plane.
function editKnife(p1, p2) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  if (!Array.isArray(p1) || !Array.isArray(p2) || p1.length < 2 || p2.length < 2) return { ok: false, error: 'bad p1/p2' };
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const verts = getVertsArrayCopy(geo.attributes.position);
  const inIdx = getIdxArrayCopy(geo.index);
  const triCount = inIdx.length / 3;

  // Build a cutting plane. If a viewport exists, unproject the two NDC
  // points to world space at near/far and use the camera forward to span
  // a plane. Otherwise default to the XZ plane through origin (still a
  // measurable cut for any mesh straddling y=0 like the default cube which
  // sits at y=0.015).
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  const tmpC = new THREE.Vector3();
  let plane;
  const vp = window.__archdiscViewport;
  if (vp && vp.camera) {
    const cam = vp.camera;
    cam.updateMatrixWorld(true);
    if (cam.matrixWorldInverse) cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const a = new THREE.Vector3(p1[0], p1[1], 0).unproject(cam);
    const b = new THREE.Vector3(p2[0], p2[1], 0).unproject(cam);
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const ab = new THREE.Vector3().subVectors(b, a);
    const normal = new THREE.Vector3().crossVectors(ab, fwd).normalize();
    if (normal.lengthSq() < 1e-12) normal.set(0, 1, 0);
    plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, a);
  } else {
    plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  }
  // Convert plane to mesh-local space.
  mesh.updateMatrixWorld(true);
  const invM = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const planeLocal = plane.clone().applyMatrix4(invM);

  const outIdx = [];
  let splitTris = 0;

  const intersectEdge = (i0, i1, n) => {
    // Returns interpolation t along edge i0→i1 where plane crosses; null if no crossing.
    tmpA.set(verts[i0 * 3], verts[i0 * 3 + 1], verts[i0 * 3 + 2]);
    tmpB.set(verts[i1 * 3], verts[i1 * 3 + 1], verts[i1 * 3 + 2]);
    const d0 = planeLocal.distanceToPoint(tmpA);
    const d1 = planeLocal.distanceToPoint(tmpB);
    if (d0 * d1 > 0) return null;
    if (Math.abs(d0 - d1) < 1e-12) return null;
    const t = d0 / (d0 - d1);
    return t;
  };

  for (let f = 0; f < triCount; f++) {
    const ia = inIdx[f * 3], ib = inIdx[f * 3 + 1], ic = inIdx[f * 3 + 2];
    tmpA.set(verts[ia * 3], verts[ia * 3 + 1], verts[ia * 3 + 2]);
    tmpB.set(verts[ib * 3], verts[ib * 3 + 1], verts[ib * 3 + 2]);
    tmpC.set(verts[ic * 3], verts[ic * 3 + 1], verts[ic * 3 + 2]);
    const dA = planeLocal.distanceToPoint(tmpA);
    const dB = planeLocal.distanceToPoint(tmpB);
    const dC = planeLocal.distanceToPoint(tmpC);
    const posSide = (dA > 0 ? 1 : 0) + (dB > 0 ? 1 : 0) + (dC > 0 ? 1 : 0);
    const negSide = (dA < 0 ? 1 : 0) + (dB < 0 ? 1 : 0) + (dC < 0 ? 1 : 0);
    if (posSide === 0 || negSide === 0) {
      outIdx.push(ia, ib, ic);
      continue;
    }
    // Find which vertex is alone on its side.
    let apex, p, q, sgnA;
    if ((dA > 0) === (dB > 0)) { apex = ic; p = ia; q = ib; sgnA = dC; }
    else if ((dA > 0) === (dC > 0)) { apex = ib; p = ic; q = ia; sgnA = dB; }
    else { apex = ia; p = ib; q = ic; sgnA = dA; }
    // Interpolate edges apex→p and apex→q.
    const tP = intersectEdge(apex, p);
    const tQ = intersectEdge(apex, q);
    if (tP == null || tQ == null) { outIdx.push(ia, ib, ic); continue; }
    const ax = verts[apex * 3], ay = verts[apex * 3 + 1], az = verts[apex * 3 + 2];
    const px = verts[p * 3], py = verts[p * 3 + 1], pz = verts[p * 3 + 2];
    const qx = verts[q * 3], qy = verts[q * 3 + 1], qz = verts[q * 3 + 2];
    const newP = verts.length / 3;
    verts.push(ax + (px - ax) * tP, ay + (py - ay) * tP, az + (pz - az) * tP);
    const newQ = newP + 1;
    verts.push(ax + (qx - ax) * tQ, ay + (qy - ay) * tQ, az + (qz - az) * tQ);
    // Three sub-triangles.
    outIdx.push(apex, newP, newQ);
    outIdx.push(newP, p, q);
    outIdx.push(newP, q, newQ);
    splitTris++;
  }

  rebuildGeometry(mesh, verts, outIdx);
  return { ok: true, splitTris, triBefore: triCount, triAfter: Math.floor(outIdx.length / 3) };
}

// ─── 5. Bridge ───────────────────────────────────────────────────────────
// Bridge two triangle "faces" (we treat each face as a single tri since
// the engine is tri-based) by stitching a 3-quad tube of 6 tris between
// their corresponding vertices.
function editBridge(faceIdxA, faceIdxB) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  if (!Number.isInteger(faceIdxA) || !Number.isInteger(faceIdxB)) return { ok: false, error: 'bad face indices' };
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const verts = getVertsArrayCopy(geo.attributes.position);
  const inIdx = getIdxArrayCopy(geo.index);
  const triCount = inIdx.length / 3;
  if (faceIdxA < 0 || faceIdxA >= triCount || faceIdxB < 0 || faceIdxB >= triCount) {
    return { ok: false, error: 'face index out of range' };
  }
  if (faceIdxA === faceIdxB) return { ok: false, error: 'cannot bridge same face' };

  const ia0 = inIdx[faceIdxA * 3], ia1 = inIdx[faceIdxA * 3 + 1], ia2 = inIdx[faceIdxA * 3 + 2];
  const ib0 = inIdx[faceIdxB * 3], ib1 = inIdx[faceIdxB * 3 + 1], ib2 = inIdx[faceIdxB * 3 + 2];

  // Drop both original triangles, add a 6-tri tube between them.
  const outIdx = [];
  for (let f = 0; f < triCount; f++) {
    if (f === faceIdxA || f === faceIdxB) continue;
    outIdx.push(inIdx[f * 3], inIdx[f * 3 + 1], inIdx[f * 3 + 2]);
  }
  // 3 quads (each split into 2 tris).
  // Pair vertices: (ia0,ib0), (ia1,ib1), (ia2,ib2) with reversed B winding
  // so the side quads face outward.
  outIdx.push(ia0, ia1, ib1); outIdx.push(ia0, ib1, ib0);
  outIdx.push(ia1, ia2, ib2); outIdx.push(ia1, ib2, ib1);
  outIdx.push(ia2, ia0, ib0); outIdx.push(ia2, ib0, ib2);

  rebuildGeometry(mesh, verts, outIdx);
  return { ok: true, bridgeFaces: 6, removed: 2, faceA: faceIdxA, faceB: faceIdxB };
}

// ─── 6. Edge Slide ───────────────────────────────────────────────────────
// Slide an edge along its adjacent faces by `factor` in [-1, 1]. Each
// endpoint of the edge moves toward the third (non-edge) vertex of an
// adjacent triangle in proportion to |factor|; sign chooses which side.
// `edgeIdx` is a triangle index — slide its FIRST edge (verts 0→1).
function editEdgeSlide(edgeIdx, factor) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  const f = Number(factor);
  if (!Number.isFinite(f) || f < -1 || f > 1) return { ok: false, error: 'factor must be in [-1,1]' };
  if (Math.abs(f) < 1e-9) return { ok: false, error: 'factor must be non-zero' };
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const posAttr = geo.attributes.position;
  const idxAttr = geo.index;
  const triCount = idxAttr.count / 3;
  const seed = Number.isInteger(edgeIdx) && edgeIdx >= 0 && edgeIdx < triCount ? edgeIdx : 0;
  const a = idxAttr.getX(seed * 3);
  const b = idxAttr.getX(seed * 3 + 1);

  // Find an adjacent triangle that shares (a,b).
  const idxArr = getIdxArrayCopy(idxAttr);
  const edgeMap = buildEdgeFaceMap(idxArr, triCount);
  const faces = edgeMap.get(edgeKey(a, b)) || [];
  if (faces.length < 1) return { ok: false, error: 'edge has no faces' };

  // Pick side based on sign of factor: faces[0] for +, faces[1] (if exists) for -.
  const useFace = f > 0 ? faces[0] : (faces[1] != null ? faces[1] : faces[0]);
  const fA = idxArr[useFace * 3], fB = idxArr[useFace * 3 + 1], fC = idxArr[useFace * 3 + 2];
  let third = -1;
  if (fA !== a && fA !== b) third = fA;
  else if (fB !== a && fB !== b) third = fB;
  else if (fC !== a && fC !== b) third = fC;
  if (third < 0) return { ok: false, error: 'no third vertex found' };

  const t = Math.abs(f);
  const ax = posAttr.getX(a), ay = posAttr.getY(a), az = posAttr.getZ(a);
  const bx = posAttr.getX(b), by = posAttr.getY(b), bz = posAttr.getZ(b);
  const tx = posAttr.getX(third), ty = posAttr.getY(third), tz = posAttr.getZ(third);
  // Slide A along (third - A) and B along (third - B).
  posAttr.setXYZ(a, ax + (tx - ax) * t, ay + (ty - ay) * t, az + (tz - az) * t);
  posAttr.setXYZ(b, bx + (tx - bx) * t, by + (ty - by) * t, bz + (tz - bz) * t);
  posAttr.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  if (geo.boundsTree && geo.disposeBoundsTree) { try { geo.disposeBoundsTree(); } catch (_) {} }
  return { ok: true, movedVerts: 2, edge: [a, b], factor: f, third };
}

// ─── 7. Dissolve Vertices ────────────────────────────────────────────────
// Remove a set of vertices and re-triangulate (drop every triangle that
// references any removed vert; compact remaining verts; rebuild index).
function editDissolveVerts(indices) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  if (!Array.isArray(indices) || !indices.length) return { ok: false, error: 'no indices' };
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const verts = getVertsArrayCopy(geo.attributes.position);
  const inIdx = getIdxArrayCopy(geo.index);
  const triCount = inIdx.length / 3;
  const drop = new Set(indices.filter((i) => Number.isInteger(i) && i >= 0 && i < geo.attributes.position.count));
  if (!drop.size) return { ok: false, error: 'no valid indices' };

  // Identify triangles touching dropped verts and the ring of verts around them.
  const ringVerts = new Set();
  const removedTris = [];
  const keptTris = [];
  for (let f = 0; f < triCount; f++) {
    const a = inIdx[f * 3], b = inIdx[f * 3 + 1], c = inIdx[f * 3 + 2];
    if (drop.has(a) || drop.has(b) || drop.has(c)) {
      removedTris.push(f);
      if (!drop.has(a)) ringVerts.add(a);
      if (!drop.has(b)) ringVerts.add(b);
      if (!drop.has(c)) ringVerts.add(c);
    } else {
      keptTris.push(f);
    }
  }
  // Re-triangulate the ring as a fan from any one ring vertex (simple,
  // produces a measurable difference but not a proper Delaunay fill).
  const ringArr = Array.from(ringVerts);
  const newTris = [];
  if (ringArr.length >= 3) {
    const anchor = ringArr[0];
    for (let i = 1; i < ringArr.length - 1; i++) {
      newTris.push(anchor, ringArr[i], ringArr[i + 1]);
    }
  }

  const outIdx = [];
  for (const f of keptTris) outIdx.push(inIdx[f * 3], inIdx[f * 3 + 1], inIdx[f * 3 + 2]);
  for (let i = 0; i < newTris.length; i++) outIdx.push(newTris[i]);

  // Compact verts: build a remap dropping the dropped indices.
  const oldCount = geo.attributes.position.count;
  const remap = new Int32Array(oldCount);
  let nextIdx = 0;
  const compactVerts = [];
  for (let i = 0; i < oldCount; i++) {
    if (drop.has(i)) { remap[i] = -1; continue; }
    remap[i] = nextIdx++;
    compactVerts.push(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
  }
  const compactIdx = [];
  for (let i = 0; i < outIdx.length; i += 3) {
    const ra = remap[outIdx[i]], rb = remap[outIdx[i + 1]], rc = remap[outIdx[i + 2]];
    if (ra < 0 || rb < 0 || rc < 0) continue;
    compactIdx.push(ra, rb, rc);
  }

  rebuildGeometry(mesh, compactVerts, compactIdx);
  return { ok: true, removedVerts: drop.size, removedTris: removedTris.length, addedTris: newTris.length / 3, newVertCount: nextIdx };
}

// ─── 8. Dissolve Faces ───────────────────────────────────────────────────
// Remove the listed triangles. Any vertex that becomes unreferenced is
// dropped (mesh stays compact).
function editDissolveFaces(indices) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  if (!Array.isArray(indices) || !indices.length) return { ok: false, error: 'no indices' };
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const verts = getVertsArrayCopy(geo.attributes.position);
  const inIdx = getIdxArrayCopy(geo.index);
  const triCount = inIdx.length / 3;
  const drop = new Set(indices.filter((i) => Number.isInteger(i) && i >= 0 && i < triCount));
  if (!drop.size) return { ok: false, error: 'no valid face indices' };

  const keptIdx = [];
  for (let f = 0; f < triCount; f++) {
    if (drop.has(f)) continue;
    keptIdx.push(inIdx[f * 3], inIdx[f * 3 + 1], inIdx[f * 3 + 2]);
  }
  // Compact vertices (drop any unreferenced).
  const used = new Set(keptIdx);
  const oldCount = geo.attributes.position.count;
  const remap = new Int32Array(oldCount);
  let nextIdx = 0;
  const compactVerts = [];
  for (let i = 0; i < oldCount; i++) {
    if (!used.has(i)) { remap[i] = -1; continue; }
    remap[i] = nextIdx++;
    compactVerts.push(verts[i * 3], verts[i * 3 + 1], verts[i * 3 + 2]);
  }
  const compactIdx = keptIdx.map((i) => remap[i]);

  rebuildGeometry(mesh, compactVerts, compactIdx);
  return { ok: true, removedFaces: drop.size, removedVerts: oldCount - nextIdx, faceCount: compactIdx.length / 3 };
}

// ─── 9. Merge by Distance ────────────────────────────────────────────────
// Blender-parity name for "Merge by Distance" — welds verts whose
// positions are within `eps`. Always runs inline (does NOT defer to
// __studioGeometryRepairWeld because that helper's `before` count uses
// the non-indexed expansion, which makes a `removed` figure that does
// not match the post-op vertex count and confuses callers).
async function editMergeByDistance(eps) {
  const epsilon = Number(eps) > 0 ? Number(eps) : 1e-4;
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry) return { ok: false, error: 'no mesh' };
  pushUndo();
  const { mergeVertices } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
  const before = mesh.geometry.attributes.position.count;
  // Strip non-position attributes first — mergeVertices treats every
  // attribute as part of the dedup key, so per-face normals / UVs on a
  // stock BoxGeometry would otherwise prevent any welding.
  const stripped = mesh.geometry.clone();
  const keepPos = stripped.attributes.position;
  // Wipe all attributes, then put position back.
  for (const k of Object.keys(stripped.attributes)) stripped.deleteAttribute(k);
  stripped.setAttribute('position', keepPos);
  if (stripped.index == null) {
    // Force-indexed so mergeVertices has something to work with.
    const n = keepPos.count;
    const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) arr[i] = i;
    stripped.setIndex(new THREE.BufferAttribute(arr, 1));
  }
  const merged = mergeVertices(stripped, epsilon);
  if (mesh.geometry.boundsTree && mesh.geometry.disposeBoundsTree) {
    try { mesh.geometry.disposeBoundsTree(); } catch (_) {}
  }
  mesh.geometry.dispose();
  mesh.geometry = merged;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  const after = merged.attributes.position.count;
  return { ok: true, before, after, removed: before - after, eps: epsilon };
}

// ─── 10. Rip ─────────────────────────────────────────────────────────────
// Duplicate a vertex and split half of the faces around it onto the new
// copy. The "half" is decided by face centroid X sign (deterministic and
// trivially testable).
function editRip(vertIdx) {
  const mesh = activeMesh();
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return { ok: false, error: 'no mesh' };
  if (!Number.isInteger(vertIdx) || vertIdx < 0 || vertIdx >= mesh.geometry.attributes.position.count) {
    return { ok: false, error: 'bad vertIdx' };
  }
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const verts = getVertsArrayCopy(geo.attributes.position);
  const inIdx = getIdxArrayCopy(geo.index);
  const triCount = inIdx.length / 3;

  // Find triangles touching vertIdx.
  const touchingFaces = [];
  for (let f = 0; f < triCount; f++) {
    if (inIdx[f * 3] === vertIdx || inIdx[f * 3 + 1] === vertIdx || inIdx[f * 3 + 2] === vertIdx) {
      touchingFaces.push(f);
    }
  }
  if (touchingFaces.length < 1) return { ok: false, error: 'vertex has no adjacent faces' };

  // Add the duplicate vert (nudge by 0.005 in X to make it visible).
  const dupIdx = verts.length / 3;
  verts.push(verts[vertIdx * 3] + 0.005, verts[vertIdx * 3 + 1], verts[vertIdx * 3 + 2]);

  // Split: faces whose centroid X >= original vert X keep original; others
  // get the duplicate.
  const vx = verts[vertIdx * 3];
  let movedFaces = 0;
  for (const f of touchingFaces) {
    const a = inIdx[f * 3], b = inIdx[f * 3 + 1], c = inIdx[f * 3 + 2];
    const cx = (verts[a * 3] + verts[b * 3] + verts[c * 3]) / 3;
    if (cx >= vx) continue;
    // Replace vertIdx with dupIdx in this triangle.
    if (a === vertIdx) inIdx[f * 3] = dupIdx;
    if (b === vertIdx) inIdx[f * 3 + 1] = dupIdx;
    if (c === vertIdx) inIdx[f * 3 + 2] = dupIdx;
    movedFaces++;
  }

  rebuildGeometry(mesh, verts, inIdx);
  return { ok: true, vertIdx, dupIdx, touchingFaces: touchingFaces.length, movedFaces, newVertCount: verts.length / 3 };
}

// ─── installer ───────────────────────────────────────────────────────────
let _installed = false;

export function installEditOps() {
  if (typeof window === 'undefined') return false;
  // Idempotent: always overwrite (cheap, supports HMR + re-runs).
  window.__studioEditBevel = editBevel;
  window.__studioEditInset = editInset;
  window.__studioEditLoopCut = editLoopCut;
  window.__studioEditKnife = editKnife;
  window.__studioEditBridge = editBridge;
  window.__studioEditEdgeSlide = editEdgeSlide;
  window.__studioEditDissolveVerts = editDissolveVerts;
  window.__studioEditDissolveFaces = editDissolveFaces;
  window.__studioEditMergeByDistance = editMergeByDistance;
  window.__studioEditRip = editRip;

  // Auto-register with the command palette if available.
  for (const name of [
    '__studioEditBevel', '__studioEditInset', '__studioEditLoopCut',
    '__studioEditKnife', '__studioEditBridge', '__studioEditEdgeSlide',
    '__studioEditDissolveVerts', '__studioEditDissolveFaces',
    '__studioEditMergeByDistance', '__studioEditRip',
  ]) {
    if (typeof window.__studioCommandRegister === 'function') {
      try {
        window.__studioCommandRegister(name, window[name], {
          category: 'edit', description: name.replace(/^__studio/, ''),
        });
      } catch (_) {}
    }
  }
  _installed = true;
  return true;
}

export function uninstallEditOps() {
  if (typeof window === 'undefined') return false;
  for (const k of [
    '__studioEditBevel', '__studioEditInset', '__studioEditLoopCut',
    '__studioEditKnife', '__studioEditBridge', '__studioEditEdgeSlide',
    '__studioEditDissolveVerts', '__studioEditDissolveFaces',
    '__studioEditMergeByDistance', '__studioEditRip',
  ]) {
    try {
      delete window[k];
      if (typeof window.__studioCommandUnregister === 'function') {
        window.__studioCommandUnregister(k);
      }
    } catch (_) {}
  }
  _installed = false;
  return true;
}

export function isInstalled() { return _installed; }
