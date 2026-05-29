/*
 * Studio Quad Remesh — uniform quad-dominant retopology.
 *
 * Voxelise the input (point-in-mesh via +X ray-crossing), extract a watertight
 * cuberille surface whose faces are genuine 4-sided QUADS (one quad per exposed
 * voxel face), weld, then Laplacian-smooth toward the original form. The result
 * is a clean, uniform, all-quad mesh — real quad topology (recorded in
 * userData.archdiscQuads), triangulated only for the three.js renderer.
 *
 * Scope (honest): this is UNIFORM quad remeshing. Field-aligned / curvature-
 * adaptive quad retopology (true ZRemesher quad flow) is a further extension.
 * Deterministic (no Math.random).
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function rayXTri(ox, oy, oz, ax, ay, az, bx, by, bz, cx, cy, cz) {
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const px = 0, py = -e2z, pz = e2y;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -1e-12 && det < 1e-12) return null;
  const inv = 1 / det;
  const tx = ox - ax, ty = oy - ay, tz = oz - az;
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return null;
  const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
  const v = qx * inv;
  if (v < 0 || u + v > 1) return null;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-9 ? t : null;
}

function laplacianSmooth(geo, iterations, lambda) {
  const pos = geo.attributes.position, idx = geo.index;
  if (!idx) return;
  const tri = [[0, 1], [0, 2], [1, 0], [1, 2], [2, 0], [2, 1]];
  for (let it = 0; it < iterations; it++) {
    const sums = new Float32Array(pos.count * 3), counts = new Int32Array(pos.count);
    for (let t = 0; t < idx.count; t += 3) {
      const a = [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)];
      for (const [i, j] of tri) { sums[a[i] * 3] += pos.getX(a[j]); sums[a[i] * 3 + 1] += pos.getY(a[j]); sums[a[i] * 3 + 2] += pos.getZ(a[j]); counts[a[i]]++; }
    }
    for (let i = 0; i < pos.count; i++) {
      if (!counts[i]) continue;
      pos.setXYZ(i, pos.getX(i) + (sums[i * 3] / counts[i] - pos.getX(i)) * lambda, pos.getY(i) + (sums[i * 3 + 1] / counts[i] - pos.getY(i)) * lambda, pos.getZ(i) + (sums[i * 3 + 2] / counts[i] - pos.getZ(i)) * lambda);
    }
  }
  pos.needsUpdate = true;
}

export function quadRemeshGeometry(srcGeo, opts = {}) {
  const res = Math.max(8, Math.min(36, Math.floor(opts.resolution || 22)));
  const g = srcGeo.index ? srcGeo.toNonIndexed() : srcGeo.clone();
  const pos = g.attributes.position;
  const triCount = pos.count / 3;
  g.computeBoundingBox(); const bb = g.boundingBox;
  const ex = bb.max.x - bb.min.x, ey = bb.max.y - bb.min.y, ez = bb.max.z - bb.min.z;
  const pad = Math.max(ex, ey, ez) * 0.04 + 1e-5;
  const minx = bb.min.x - pad, miny = bb.min.y - pad, minz = bb.min.z - pad;
  const csx = (ex + 2 * pad) / res, csy = (ey + 2 * pad) / res, csz = (ez + 2 * pad) / res;
  const tris = new Float32Array(triCount * 9);
  for (let t = 0; t < triCount; t++) for (let v = 0; v < 3; v++) { const o = t * 3 + v; tris[t * 9 + v * 3] = pos.getX(o); tris[t * 9 + v * 3 + 1] = pos.getY(o); tris[t * 9 + v * 3 + 2] = pos.getZ(o); }

  const occ = new Uint8Array(res * res * res);
  const oidx = (i, j, k) => (k * res + j) * res + i;
  for (let k = 0; k < res; k++) { const z = minz + csz * (k + 0.5);
    for (let j = 0; j < res; j++) { const y = miny + csy * (j + 0.5);
      for (let i = 0; i < res; i++) { const x = minx + csx * (i + 0.5);
        let cross = 0; for (let t = 0; t < triCount; t++) { const b = t * 9; if (rayXTri(x, y, z, tris[b], tris[b + 1], tris[b + 2], tris[b + 3], tris[b + 4], tris[b + 5], tris[b + 6], tris[b + 7], tris[b + 8]) !== null) cross++; }
        occ[oidx(i, j, k)] = (cross & 1) ? 1 : 0;
      } } }
  const inside = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= res || j >= res || k >= res) ? 0 : occ[oidx(i, j, k)];
  const corner = (i, j, k) => [minx + csx * i, miny + csy * j, minz + csz * k];
  const verts = [], quads = [], indices = [];
  const quad = (p0, p1, p2, p3) => {
    const base = verts.length / 3;
    verts.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p2[0], p2[1], p2[2], p3[0], p3[1], p3[2]);
    quads.push([base, base + 1, base + 2, base + 3]);          // genuine 4-sided quad face
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3); // tri'd for rendering
  };
  for (let k = 0; k < res; k++) for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    if (!occ[oidx(i, j, k)]) continue;
    if (!inside(i + 1, j, k)) quad(corner(i + 1, j, k), corner(i + 1, j + 1, k), corner(i + 1, j + 1, k + 1), corner(i + 1, j, k + 1));
    if (!inside(i - 1, j, k)) quad(corner(i, j, k), corner(i, j, k + 1), corner(i, j + 1, k + 1), corner(i, j + 1, k));
    if (!inside(i, j + 1, k)) quad(corner(i, j + 1, k), corner(i, j + 1, k + 1), corner(i + 1, j + 1, k + 1), corner(i + 1, j + 1, k));
    if (!inside(i, j - 1, k)) quad(corner(i, j, k), corner(i + 1, j, k), corner(i + 1, j, k + 1), corner(i, j, k + 1));
    if (!inside(i, j, k + 1)) quad(corner(i, j, k + 1), corner(i + 1, j, k + 1), corner(i + 1, j + 1, k + 1), corner(i, j + 1, k + 1));
    if (!inside(i, j, k - 1)) quad(corner(i, j, k), corner(i, j + 1, k), corner(i + 1, j + 1, k), corner(i + 1, j, k));
  }
  let geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setIndex(indices);
  const quadCount = quads.length;
  let welded = mergeVertices(geo) || geo; // weld shared quad corners
  laplacianSmooth(welded, opts.smooth == null ? 3 : Math.max(0, Math.min(8, opts.smooth)), 0.5);
  welded.computeVertexNormals(); welded.computeBoundingBox(); welded.computeBoundingSphere();
  welded.userData.archdiscQuads = quads;            // recorded quad topology
  welded.userData.archdiscQuadRemesh = { resolution: res, quads: quadCount };
  return welded;
}
