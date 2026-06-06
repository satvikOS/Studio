// Slice 767 — Houdini RBD destruction: Voronoi fracture.
//
// Given a source THREE.BufferGeometry and a count of fracture sites,
// generate `sites` deterministic points inside the geometry's axis-aligned
// bounding box (mulberry32 RNG so identical seeds reproduce identical
// shrapnel), build the Voronoi cell around each site, and clip the source
// geometry into per-cell chunk meshes.
//
// Implementation notes:
//
//   • Voronoi cells are constructed as the intersection of half-spaces
//     defined by the perpendicular bisectors between site i and every
//     other site, intersected with the AABB. We start from the bbox
//     polyhedron (6 planes) and successively clip it by every bisector
//     plane. The bbox-as-the-outer-shell is the standard cheap-Voronoi
//     approach: chunks at the boundary inherit the bbox face, which
//     reads as a clean fracture on the original mesh's silhouette.
//
//   • Polyhedron representation: array of convex polygon faces, each a
//     CCW-ordered list of THREE.Vector3 around its outward normal.
//     Plane clipping splits/keeps each face and re-stitches a single
//     cap polygon from the cut edges.
//
//   • Mesh clipping: each source triangle is clipped against the cell
//     polyhedron (Sutherland-Hodgman against each cell plane), then
//     fan-triangulated. The resulting chunk geometry is the union of
//     the clipped source triangles PLUS the polyhedron's own cap faces
//     (the cut surfaces), so the chunk is a closed solid.
//
//   • Centroid: average of the chunk's clipped-triangle vertices, used
//     by rbdSim.js as the body's centre of mass and by __studioRBDExplode
//     as the radial impulse origin.
//
// Pure JS, no external dependencies, NO Math.random. Deterministic.

import * as THREE from 'three';
import { mulberry32 } from '../common/random.js';

const EPS = 1e-7;

// Deterministic uniform site distribution inside `bbox`.
// `seed` is coerced to u32; identical seeds reproduce identical sites.
export function randomSites(bbox, count, seed) {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  const rng = mulberry32(Number(seed) || 1);
  const sx = bbox.max.x - bbox.min.x;
  const sy = bbox.max.y - bbox.min.y;
  const sz = bbox.max.z - bbox.min.z;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = new THREE.Vector3(
      bbox.min.x + rng() * sx,
      bbox.min.y + rng() * sy,
      bbox.min.z + rng() * sz,
    );
  }
  return out;
}

// Build the bbox polyhedron: six axis-aligned faces, outward-normal CCW.
function bboxPolyhedron(bbox) {
  const min = bbox.min, max = bbox.max;
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  // 8 corners, named by sign of each axis.
  const p000 = v(min.x, min.y, min.z);
  const p100 = v(max.x, min.y, min.z);
  const p010 = v(min.x, max.y, min.z);
  const p110 = v(max.x, max.y, min.z);
  const p001 = v(min.x, min.y, max.z);
  const p101 = v(max.x, min.y, max.z);
  const p011 = v(min.x, max.y, max.z);
  const p111 = v(max.x, max.y, max.z);
  // Faces: CCW when viewed from the outside (outward normal points away
  // from the box centre).
  return [
    // -X: outward normal -X, CCW seen from -X.
    [p000, p010, p011, p001],
    // +X: outward normal +X.
    [p100, p101, p111, p110],
    // -Y: outward normal -Y.
    [p000, p001, p101, p100],
    // +Y: outward normal +Y.
    [p010, p110, p111, p011],
    // -Z: outward normal -Z.
    [p000, p100, p110, p010],
    // +Z: outward normal +Z.
    [p001, p011, p111, p101],
  ];
}

// Plane defined as { normal:Vector3 (unit), constant:number } so that
// signed distance = normal·p - constant; "inside" the cell means
// distance ≤ 0.
function planeFromBisector(siteA, siteB) {
  // Half-space containing siteA: points p with |p-siteA| ≤ |p-siteB|.
  // That expands to normal·p - constant ≤ 0 with
  //   normal = (siteB - siteA) (un-normalised would still work, but we
  //   normalise to keep numerics stable),
  //   constant = normal · midpoint.
  const n = new THREE.Vector3().subVectors(siteB, siteA);
  const len = n.length();
  if (len < EPS) return null;
  n.divideScalar(len);
  const mid = new THREE.Vector3().addVectors(siteA, siteB).multiplyScalar(0.5);
  return { normal: n, constant: n.dot(mid) };
}

function planeSignedDist(plane, p) {
  return plane.normal.x * p.x + plane.normal.y * p.y + plane.normal.z * p.z - plane.constant;
}

// Sutherland-Hodgman 3D: clip a single CCW polygon (list of Vector3)
// against `plane`, keeping the portion where signedDist ≤ 0. Returns
// {polygon, cutEdge}. `cutEdge` is null when the polygon is fully kept
// or fully discarded, otherwise [Vector3, Vector3] — the two points
// where the plane intersected the polygon boundary, in the order the
// clip walked them. Caller uses the cut edges to stitch the cap.
function clipPolygonByPlane(polygon, plane) {
  const out = [];
  const cutPts = [];
  const n = polygon.length;
  if (n === 0) return { polygon: out, cutEdge: null };
  let prev = polygon[n - 1];
  let prevD = planeSignedDist(plane, prev);
  for (let i = 0; i < n; i++) {
    const cur = polygon[i];
    const curD = planeSignedDist(plane, cur);
    const prevInside = prevD <= EPS;
    const curInside = curD <= EPS;
    if (prevInside && curInside) {
      out.push(cur);
    } else if (prevInside && !curInside) {
      // Going out: emit the intersection.
      const t = prevD / (prevD - curD);
      const ip = new THREE.Vector3(
        prev.x + (cur.x - prev.x) * t,
        prev.y + (cur.y - prev.y) * t,
        prev.z + (cur.z - prev.z) * t,
      );
      out.push(ip);
      cutPts.push(ip);
    } else if (!prevInside && curInside) {
      // Coming in: emit the intersection then the current vertex.
      const t = prevD / (prevD - curD);
      const ip = new THREE.Vector3(
        prev.x + (cur.x - prev.x) * t,
        prev.y + (cur.y - prev.y) * t,
        prev.z + (cur.z - prev.z) * t,
      );
      out.push(ip);
      out.push(cur);
      cutPts.push(ip);
    }
    prev = cur;
    prevD = curD;
  }
  // A convex polygon cleanly clipped by a plane produces ≤ 2 cut points.
  let cutEdge = null;
  if (cutPts.length === 2) cutEdge = [cutPts[0], cutPts[1]];
  return { polygon: out, cutEdge };
}

// Clip a polyhedron (array of CCW polygons) by a plane; keeps the
// `signedDist ≤ 0` side and stitches a single cap polygon from the cut
// edges so the result is still closed.
function clipPolyhedronByPlane(polyhedron, plane) {
  const kept = [];
  const cutEdges = [];
  for (const face of polyhedron) {
    const { polygon, cutEdge } = clipPolygonByPlane(face, plane);
    if (polygon.length >= 3) kept.push(polygon);
    if (cutEdge) cutEdges.push(cutEdge);
  }
  if (kept.length === 0) return [];
  if (cutEdges.length >= 3) {
    // Stitch the cut edges into a single polygon. With a convex
    // polyhedron and a single clipping plane every face contributes ≤ 1
    // cut edge, and those edges chain head-to-tail around the cap. We
    // walk a greedy chain using the smallest-distance heuristic to be
    // robust against tiny floating-point gaps.
    const cap = stitchCap(cutEdges, plane);
    if (cap && cap.length >= 3) kept.push(cap);
  }
  return kept;
}

// Tolerant point equality.
function ptEq(a, b) {
  return Math.abs(a.x - b.x) < 1e-5
      && Math.abs(a.y - b.y) < 1e-5
      && Math.abs(a.z - b.z) < 1e-5;
}

// Walk cut edges into a polygon. The cap normal must agree with the
// clipping plane normal (the cut surface faces the side we discarded),
// so we reverse if the signed area against `plane.normal` is negative.
function stitchCap(cutEdges, plane) {
  const edges = cutEdges.slice();
  if (edges.length < 3) return null;
  const start = edges.shift();
  const poly = [start[0], start[1]];
  while (edges.length > 0) {
    const tail = poly[poly.length - 1];
    let bestIdx = -1;
    let bestRev = false;
    let bestD = Infinity;
    for (let i = 0; i < edges.length; i++) {
      const e = edges[i];
      const d0 = tail.distanceToSquared(e[0]);
      const d1 = tail.distanceToSquared(e[1]);
      if (d0 < bestD) { bestD = d0; bestIdx = i; bestRev = false; }
      if (d1 < bestD) { bestD = d1; bestIdx = i; bestRev = true;  }
    }
    if (bestIdx < 0) break;
    const e = edges.splice(bestIdx, 1)[0];
    const next = bestRev ? e[0] : e[1];
    if (!ptEq(tail, next)) poly.push(next);
    else if (e) poly.push(bestRev ? e[0] : e[1]);
  }
  // Drop a duplicate trailing copy of the start point if present.
  if (poly.length >= 2 && ptEq(poly[0], poly[poly.length - 1])) poly.pop();
  if (poly.length < 3) return null;
  // Orient CCW around plane.normal. Compute the signed area projected
  // onto the plane normal via Newell's method.
  const n = computePolygonNormal(poly);
  if (n.dot(plane.normal) < 0) poly.reverse();
  return poly;
}

function computePolygonNormal(poly) {
  const n = new THREE.Vector3(0, 0, 0);
  for (let i = 0; i < poly.length; i++) {
    const cur = poly[i];
    const nxt = poly[(i + 1) % poly.length];
    n.x += (cur.y - nxt.y) * (cur.z + nxt.z);
    n.y += (cur.z - nxt.z) * (cur.x + nxt.x);
    n.z += (cur.x - nxt.x) * (cur.y + nxt.y);
  }
  if (n.lengthSq() > EPS) n.normalize();
  return n;
}

// Build the Voronoi cell polyhedron for site i by clipping the bbox
// polyhedron against every bisector plane (siteI, siteJ).
function buildVoronoiCell(sites, i, bbox) {
  let cell = bboxPolyhedron(bbox);
  for (let j = 0; j < sites.length; j++) {
    if (j === i) continue;
    const plane = planeFromBisector(sites[i], sites[j]);
    if (!plane) continue;
    cell = clipPolyhedronByPlane(cell, plane);
    if (cell.length === 0) return null;
  }
  return cell;
}

// Iterate triangles from a BufferGeometry, calling cb(a,b,c) per face.
function forEachTriangle(geometry, cb) {
  const pos = geometry.attributes && geometry.attributes.position;
  if (!pos) return;
  const idx = geometry.index;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  if (idx) {
    const ia = idx.array;
    for (let i = 0; i < ia.length; i += 3) {
      a.fromBufferAttribute(pos, ia[i]);
      b.fromBufferAttribute(pos, ia[i + 1]);
      c.fromBufferAttribute(pos, ia[i + 2]);
      cb(a.clone(), b.clone(), c.clone());
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i);
      b.fromBufferAttribute(pos, i + 1);
      c.fromBufferAttribute(pos, i + 2);
      cb(a.clone(), b.clone(), c.clone());
    }
  }
}

// Clip a single triangle polygon by every cell plane. Returns the
// surviving CCW polygon (≥3 verts) or null.
function clipTriangleAgainstCell(tri, cellPlanes) {
  let poly = tri;
  for (const plane of cellPlanes) {
    const { polygon } = clipPolygonByPlane(poly, plane);
    if (polygon.length < 3) return null;
    poly = polygon;
  }
  return poly;
}

// Convert a cell polyhedron back to its bounding planes so we can clip
// source triangles against the same half-spaces. The plane normal is
// the polygon's outward normal; constant = normal · firstVertex.
function cellToPlanes(cell) {
  const planes = [];
  for (const face of cell) {
    if (face.length < 3) continue;
    const n = computePolygonNormal(face);
    if (n.lengthSq() < EPS) continue;
    planes.push({ normal: n, constant: n.dot(face[0]) });
  }
  return planes;
}

// Fan-triangulate a CCW convex polygon into an array of [a,b,c] tris.
function fanTriangulate(poly) {
  const out = [];
  for (let i = 1; i < poly.length - 1; i++) {
    out.push([poly[0], poly[i], poly[i + 1]]);
  }
  return out;
}

// Build a chunk THREE.BufferGeometry from triangle list + record the
// vertex centroid for the sim.
function chunkFromTriangles(tris) {
  const geom = new THREE.BufferGeometry();
  if (tris.length === 0) return { geometry: geom, centroid: new THREE.Vector3() };
  const positions = new Float32Array(tris.length * 9);
  let p = 0;
  const c = new THREE.Vector3();
  for (const [a, b, cc] of tris) {
    positions[p++] = a.x; positions[p++] = a.y; positions[p++] = a.z;
    positions[p++] = b.x; positions[p++] = b.y; positions[p++] = b.z;
    positions[p++] = cc.x; positions[p++] = cc.y; positions[p++] = cc.z;
    c.x += a.x + b.x + cc.x;
    c.y += a.y + b.y + cc.y;
    c.z += a.z + b.z + cc.z;
  }
  const vertCount = tris.length * 3;
  c.divideScalar(vertCount);
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  return { geometry: geom, centroid: c };
}

// PUBLIC: voronoiFracture(geometry, sites, seed)
//
// `geometry` may be a THREE.BufferGeometry OR a count of sites scalar
// when the caller wants to fall back to a procedurally generated unit
// cube. We accept (geometry, sites, seed) per the slice contract.
//
// Returns: [{ geometry, centroid }, …] — one entry per non-empty Voronoi
// cell. Empty cells (e.g. a site fully shadowed by neighbours) are
// dropped, which is why the returned chunk count CAN be ≤ sites — in
// practice for uniform sites inside the bbox every cell is non-empty.
export function voronoiFracture(geometry, sites, seed) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) {
    return [];
  }
  geometry.computeBoundingBox();
  const bbox = geometry.boundingBox.clone();
  // Pad bbox slightly so triangles lying exactly on the boundary stay
  // inside after clipping noise.
  bbox.expandByScalar(1e-4);

  const siteCount = Math.max(1, Math.floor(Number(sites) || 1));
  const sitePts = randomSites(bbox, siteCount, seed);

  // Pre-collect source triangles once; reused per cell.
  const sourceTris = [];
  forEachTriangle(geometry, (a, b, c) => { sourceTris.push([a, b, c]); });

  const chunks = [];
  for (let i = 0; i < sitePts.length; i++) {
    const cell = buildVoronoiCell(sitePts, i, bbox);
    if (!cell || cell.length === 0) continue;
    const planes = cellToPlanes(cell);
    if (planes.length === 0) continue;

    const chunkTris = [];

    // 1. Clip every source triangle against this cell.
    for (const tri of sourceTris) {
      const clipped = clipTriangleAgainstCell(tri, planes);
      if (!clipped || clipped.length < 3) continue;
      const sub = fanTriangulate(clipped);
      for (const t of sub) chunkTris.push(t);
    }

    // 2. Add the cell's own faces as cap geometry so the chunk is a
    // closed solid (the cuts between neighbouring chunks).
    for (const face of cell) {
      if (face.length < 3) continue;
      const sub = fanTriangulate(face);
      for (const t of sub) chunkTris.push(t);
    }

    if (chunkTris.length === 0) continue;
    chunks.push(chunkFromTriangles(chunkTris));
  }

  return chunks;
}
