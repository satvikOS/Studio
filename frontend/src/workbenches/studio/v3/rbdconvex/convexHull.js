// Slice 778 — convex hull construction for GJK/EPA bodies.
//
// We don't actually need a *visible* hull mesh here — GJK/EPA only need
// the vertex set. So this module is intentionally light:
//
//   convexHullFromMesh(mesh) → { vertices:[{x,y,z}], supportFn }
//     Pulls vertex positions from a THREE.Mesh (BufferGeometry +
//     position attribute), bakes the mesh's *current* world matrix
//     into them, dedupes near-duplicates, and stitches a supportFn
//     closure for fast direction queries.
//
//   convexHullFromPoints(points) → { vertices, supportFn }
//     Same but starting from a plain {x,y,z}[] cloud.
//
//   quickHullExtremes(points) → indices of 6 extreme points (±x,±y,±z)
//     A lightweight QuickHull-style "pre-pass" — if the caller wants to
//     trim a very dense point cloud to its extremes before feeding GJK
//     they can. For convex collision the support function over the full
//     vertex set is already O(n) so trimming is a perf optimization, not
//     correctness.
//
// We deliberately DO NOT pull in `three/examples/jsm/geometries/ConvexGeometry.js`
// for two reasons:
//   (1) ConvexGeometry is a `BufferGeometry` builder (visible faces),
//       not a hull point set — we'd just iterate its position attribute
//       anyway and we already have THAT in the source mesh.
//   (2) Slice 778 ships in the "no new deps" lane for the Studio
//       parity drive. Three's ConvexGeometry is part of three.js but the
//       /examples/jsm submodules aren't pulled in by every Studio
//       module — we keep the dependency surface flat.
//
// Pure JS. No THREE import (vertex extraction is done by the caller via
// `pos.getX(i)/getY(i)/getZ(i)` and we just consume the resulting array).

import * as THREE from 'three';

const DEDUPE_EPS_SQ = 1e-10;

// Build a hull point set from a THREE.Mesh. Vertex positions are baked
// into world space using the mesh's matrixWorld so the GJK math works on
// real positions, *separated from* the position the solver applies.
//
// Returns:
//   { vertices: [{x,y,z}, …], supportFn(dir) → {x,y,z}, bbox, centroid }
//
// The mesh's position is REMOVED from the vertex set (we subtract the
// world centroid) so the hull is in "body-local" space; the solver then
// translates by `body.position` to do the GJK query. This matches the
// rbddestruct convention.
export function convexHullFromMesh(mesh) {
  if (!mesh || !mesh.geometry) {
    return makeHull([]);
  }
  mesh.updateMatrixWorld(true);
  const geom = mesh.geometry;
  const pos = geom.attributes && geom.attributes.position;
  if (!pos) return makeHull([]);
  const m = mesh.matrixWorld;
  const vec = new THREE.Vector3();
  const raw = [];
  for (let i = 0; i < pos.count; i++) {
    vec.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
    raw.push({ x: vec.x, y: vec.y, z: vec.z });
  }
  // Compute world centroid; vertices recorded relative to it so the
  // hull is body-local.
  const c = centroid(raw);
  const local = raw.map((p) => ({ x: p.x - c.x, y: p.y - c.y, z: p.z - c.z }));
  const dedup = dedupeVertices(local);
  return makeHull(dedup, c);
}

// Build a hull directly from a {x,y,z}[] cloud. Centroid is computed and
// the returned hull is centred on its own centroid (so the caller can
// position the body via solver.position).
export function convexHullFromPoints(points) {
  if (!Array.isArray(points) || points.length === 0) return makeHull([]);
  const c = centroid(points);
  const local = points.map((p) => ({ x: p.x - c.x, y: p.y - c.y, z: p.z - c.z }));
  const dedup = dedupeVertices(local);
  return makeHull(dedup, c);
}

// Build a simple box hull from half-extents — handy for unit-test cubes
// and the e2e fall-back when a caller passes raw `size:[w,h,d]`.
export function convexHullFromBox(halfX, halfY, halfZ) {
  const verts = [];
  for (const sx of [-halfX, halfX]) {
    for (const sy of [-halfY, halfY]) {
      for (const sz of [-halfZ, halfZ]) {
        verts.push({ x: sx, y: sy, z: sz });
      }
    }
  }
  return makeHull(verts, { x: 0, y: 0, z: 0 });
}

// QuickHull-style extremes pre-pass: returns the indices of the 6 cardinal
// extremes (±x, ±y, ±z) of the cloud. Useful for trimming a dense point
// cloud before feeding GJK on very heavy hulls.
export function quickHullExtremes(points) {
  if (!Array.isArray(points) || points.length === 0) return [];
  let minX = 0, maxX = 0, minY = 0, maxY = 0, minZ = 0, maxZ = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].x < points[minX].x) minX = i;
    if (points[i].x > points[maxX].x) maxX = i;
    if (points[i].y < points[minY].y) minY = i;
    if (points[i].y > points[maxY].y) maxY = i;
    if (points[i].z < points[minZ].z) minZ = i;
    if (points[i].z > points[maxZ].z) maxZ = i;
  }
  return Array.from(new Set([minX, maxX, minY, maxY, minZ, maxZ]));
}

// ─── Internals ─────────────────────────────────────────────────────────

function makeHull(vertices, sourceCentroid) {
  const h = {
    vertices: vertices,
    sourceCentroid: sourceCentroid || { x: 0, y: 0, z: 0 },
  };
  // Body-local AABB for cheap broad-phase rejection.
  if (vertices.length === 0) {
    h.aabb = { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  } else {
    let mnx = vertices[0].x, mny = vertices[0].y, mnz = vertices[0].z;
    let mxx = vertices[0].x, mxy = vertices[0].y, mxz = vertices[0].z;
    for (const v of vertices) {
      if (v.x < mnx) mnx = v.x; if (v.x > mxx) mxx = v.x;
      if (v.y < mny) mny = v.y; if (v.y > mxy) mxy = v.y;
      if (v.z < mnz) mnz = v.z; if (v.z > mxz) mxz = v.z;
    }
    h.aabb = { min: { x: mnx, y: mny, z: mnz }, max: { x: mxx, y: mxy, z: mxz } };
  }
  h.supportFn = function supportFn(d) {
    if (vertices.length === 0) return { x: 0, y: 0, z: 0 };
    let bestI = 0;
    let bestDot = vertices[0].x * d.x + vertices[0].y * d.y + vertices[0].z * d.z;
    for (let i = 1; i < vertices.length; i++) {
      const v = vertices[i];
      const dd = v.x * d.x + v.y * d.y + v.z * d.z;
      if (dd > bestDot) { bestDot = dd; bestI = i; }
    }
    return vertices[bestI];
  };
  return h;
}

function centroid(pts) {
  if (pts.length === 0) return { x: 0, y: 0, z: 0 };
  let sx = 0, sy = 0, sz = 0;
  for (const p of pts) { sx += p.x; sy += p.y; sz += p.z; }
  return { x: sx / pts.length, y: sy / pts.length, z: sz / pts.length };
}

function dedupeVertices(pts) {
  if (pts.length < 2) return pts.slice();
  const out = [];
  for (const p of pts) {
    let dupe = false;
    for (const q of out) {
      const dx = p.x - q.x, dy = p.y - q.y, dz = p.z - q.z;
      if (dx * dx + dy * dy + dz * dz < DEDUPE_EPS_SQ) { dupe = true; break; }
    }
    if (!dupe) out.push(p);
  }
  return out;
}
