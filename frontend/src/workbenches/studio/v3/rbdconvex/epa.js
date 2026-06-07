// Slice 778 — Expanding Polytope Algorithm (EPA) for convex penetration
// depth & normal.
//
// EPA picks up where GJK leaves off: given a terminating tetrahedron
// that encloses the origin in the Minkowski difference, EPA grows the
// polytope outward, one new support point at a time, until the closest
// face is the actual closest face of A ⊖ B. That face's outward normal
// is the contact normal, and the distance from origin to face is the
// penetration depth.
//
// The polytope is stored as `vertices` (array of `{x,y,z}` Minkowski
// points) + `faces` (array of `{a,b,c, normal:{x,y,z}, distance}` index
// triples with outward normal precomputed for the current vertex set).
// Each iteration:
//   1. find the face closest to the origin                  O(F)
//   2. support the Minkowski difference in that face normal
//   3. if the support is no farther from origin than the face → done
//   4. otherwise:
//        a. remove every face the new support can "see"        (silhouette)
//        b. find the silhouette edges of that hole
//        c. stitch a face from each silhouette edge to the new vertex
//
// Capped at 32 iterations so a degenerate hull can't loop.
//
// Returns:
//   { ok:true, normal:{x,y,z}, depth:number }                 — success
//   { ok:false, error:'...' }                                  — failure

import { dot, sub, cross, lenSq, scale, supportCSO } from './gjk.js';

const EPS = 1e-9;
const MAX_ITER = 32;

export function epa(hullA, hullB, gjkSimplex) {
  if (!gjkSimplex || gjkSimplex.length < 4) {
    return { ok: false, error: 'EPA needs a tetrahedron seed' };
  }

  // Strip the simplex to just the Minkowski points (we don't need p/q
  // for boolean penetration, just `w`).
  const vertices = [
    { x: gjkSimplex[0].w.x, y: gjkSimplex[0].w.y, z: gjkSimplex[0].w.z },
    { x: gjkSimplex[1].w.x, y: gjkSimplex[1].w.y, z: gjkSimplex[1].w.z },
    { x: gjkSimplex[2].w.x, y: gjkSimplex[2].w.y, z: gjkSimplex[2].w.z },
    { x: gjkSimplex[3].w.x, y: gjkSimplex[3].w.y, z: gjkSimplex[3].w.z },
  ];
  // Seed faces of the tetrahedron with outward-pointing normals.
  let faces = makeTetraFaces(vertices);
  if (!faces) return { ok: false, error: 'degenerate seed tetrahedron' };

  for (let iter = 0; iter < MAX_ITER; iter++) {
    // 1. Find closest face to origin.
    let closestIdx = 0;
    let closestDist = faces[0].distance;
    for (let i = 1; i < faces.length; i++) {
      if (faces[i].distance < closestDist) {
        closestDist = faces[i].distance;
        closestIdx = i;
      }
    }
    const f = faces[closestIdx];

    // 2. Support along that face's outward normal.
    const sp = supportCSO(hullA, hullB, f.normal);
    const w = sp.w;
    const supportDist = dot(w, f.normal);

    // 3. Converged?
    if (supportDist - closestDist < 1e-5) {
      return {
        ok: true,
        normal: { x: f.normal.x, y: f.normal.y, z: f.normal.z },
        depth: closestDist,
      };
    }

    // 4a. Find every face the new support can "see" (faces whose
    // outward normal points toward `w`). Collect their edges.
    const visible = [];
    for (let i = 0; i < faces.length; i++) {
      const fi = faces[i];
      const rel = sub(w, vertices[fi.a]);
      if (dot(fi.normal, rel) > EPS) visible.push(i);
    }
    if (visible.length === 0) {
      // The new support didn't actually beat any face — bail.
      return {
        ok: true,
        normal: { x: f.normal.x, y: f.normal.y, z: f.normal.z },
        depth: closestDist,
      };
    }

    // 4b. Silhouette: edges shared by exactly one visible face form the
    // open hole that needs new triangles stitched to `w`.
    const edgeCount = new Map();
    const edgeOrder = []; // preserve insertion to keep winding stable
    for (const idx of visible) {
      const fi = faces[idx];
      addEdge(edgeCount, edgeOrder, fi.a, fi.b);
      addEdge(edgeCount, edgeOrder, fi.b, fi.c);
      addEdge(edgeCount, edgeOrder, fi.c, fi.a);
    }
    // Remove visible faces (high → low so indices stay valid).
    visible.sort((a, b) => b - a);
    for (const idx of visible) faces.splice(idx, 1);

    // 4c. Add the new vertex, stitch faces from silhouette edges to it.
    const newIdx = vertices.length;
    vertices.push({ x: w.x, y: w.y, z: w.z });
    for (const key of edgeOrder) {
      if (edgeCount.get(key) !== 1) continue;
      const [a, b] = key.split(',').map(Number);
      const nf = makeFace(vertices, a, b, newIdx);
      if (nf) faces.push(nf);
    }
    if (faces.length === 0) {
      return { ok: false, error: 'EPA polytope collapsed' };
    }
  }

  // Exhausted iterations — return the best face we have.
  let closestIdx = 0;
  let closestDist = faces[0].distance;
  for (let i = 1; i < faces.length; i++) {
    if (faces[i].distance < closestDist) {
      closestDist = faces[i].distance;
      closestIdx = i;
    }
  }
  const f = faces[closestIdx];
  return {
    ok: true,
    normal: { x: f.normal.x, y: f.normal.y, z: f.normal.z },
    depth: closestDist,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

// Build the four faces of a tetrahedron with normals pointing AWAY from
// the centroid (so "closest face to origin" gives the right outward
// direction for EPA's penetration normal).
function makeTetraFaces(v) {
  const c = {
    x: (v[0].x + v[1].x + v[2].x + v[3].x) * 0.25,
    y: (v[0].y + v[1].y + v[2].y + v[3].y) * 0.25,
    z: (v[0].z + v[1].z + v[2].z + v[3].z) * 0.25,
  };
  const faces = [];
  const tris = [
    [0, 1, 2, 3],
    [0, 2, 3, 1],
    [0, 3, 1, 2],
    [1, 3, 2, 0],
  ];
  for (const [a, b, cIdx, oppIdx] of tris) {
    const f = makeFaceOriented(v, a, b, cIdx, c, oppIdx);
    if (!f) return null;
    faces.push(f);
  }
  return faces;
}

// Build a face whose normal points away from `centroid` (used at tetra
// seed time so all four faces are outward-oriented).
function makeFaceOriented(v, a, b, c, centroid /* , oppIdx */) {
  const ab = sub(v[b], v[a]);
  const ac = sub(v[c], v[a]);
  let n = cross(ab, ac);
  const len2 = lenSq(n);
  if (len2 < EPS) return null;
  const invLen = 1 / Math.sqrt(len2);
  n = { x: n.x * invLen, y: n.y * invLen, z: n.z * invLen };
  // Flip if pointing toward centroid (we want OUTWARD).
  const cv = sub(centroid, v[a]);
  if (dot(n, cv) > 0) {
    n = { x: -n.x, y: -n.y, z: -n.z };
    return { a: a, b: c, c: b, normal: n, distance: -dot(n, v[a]) >= 0 ? dot(n, v[a]) : -dot(n, v[a]) };
  }
  return { a, b, c, normal: n, distance: Math.max(0, dot(n, v[a])) };
}

// Build a face for an arbitrary (a,b,c) triple. The normal is oriented
// AWAY from the origin (the current EPA polytope contains the origin, so
// the face's outward normal is whichever points away from origin).
function makeFace(verts, a, b, c) {
  const ab = sub(verts[b], verts[a]);
  const ac = sub(verts[c], verts[a]);
  let n = cross(ab, ac);
  const len2 = lenSq(n);
  if (len2 < EPS) return null;
  const invLen = 1 / Math.sqrt(len2);
  n = { x: n.x * invLen, y: n.y * invLen, z: n.z * invLen };
  // Distance from origin along normal (signed). If negative, our normal
  // points toward the origin — flip it (and the winding so a,b,c stays
  // consistent with the normal).
  let d = dot(n, verts[a]);
  if (d < 0) {
    n = { x: -n.x, y: -n.y, z: -n.z };
    d = -d;
    return { a, b: c, c: b, normal: n, distance: d };
  }
  return { a, b, c, normal: n, distance: d };
}

// Silhouette edges are tracked as ordered pairs. A "shared" edge is the
// reverse pair of an edge already inserted — those edges are interior
// to the visible region and shouldn't appear in the silhouette.
function addEdge(map, order, a, b) {
  const fwd = `${a},${b}`;
  const rev = `${b},${a}`;
  if (map.has(rev)) {
    // Interior edge — both faces touching it are visible. Drop it.
    map.set(rev, (map.get(rev) || 0) + 1);
    return;
  }
  if (map.has(fwd)) {
    map.set(fwd, map.get(fwd) + 1);
  } else {
    map.set(fwd, 1);
    order.push(fwd);
  }
}
