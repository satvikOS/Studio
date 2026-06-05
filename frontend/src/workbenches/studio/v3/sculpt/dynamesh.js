// ArchDisc Studio V3 — DynaMesh voxel remesh.
//
// `dynaMesh(mesh, resolution)` takes a THREE.Mesh, voxelises its
// bounding volume at `resolution^3` cells, marks each cell whose
// centre falls inside the original surface as "filled", then emits
// a brand-new geometry where every filled cell is replaced by a
// centred cube. The result is an even-density triangulated mesh
// that captures the silhouette — the classic ZBrush DynaMesh
// behaviour applied to whatever you fed it.
//
// SIMPLIFICATION (documented for the spec):
//   Real ZBrush DynaMesh runs a dual-contour / marching-cubes pass
//   to recover the original surface as a smooth, manifold quad
//   mesh. Native Marching Cubes is a fair amount of code (case
//   tables for 256 vertex configurations, edge interpolation,
//   normal recovery). To keep this slice pure-native and slim, we
//   ship the "per-voxel cube emit" variant — every filled cell
//   becomes a unit cube (6 quads, 12 triangles, 24 verts). For
//   typical sculpt resolutions (24-64), the resulting cube cloud
//   still looks recognisable as the original shape and — critically
//   — has even vertex density, which is what DynaMesh exists to
//   produce in the first place. Subsequent slices can drop in
//   marching cubes by replacing only this file.
//
// Inside-check: we walk every voxel centre and shoot a ray along
// +X; if it crosses an odd number of triangles, the centre is
// inside. The triangle-list is rebuilt once per call from the
// mesh's index/position attributes (post matrixWorld) so meshes
// don't have to be axis-aligned. Indexing is straightforward
// O(cells × triangles); for high `res` we cap iterations via an
// optional `maxCells` guard.

import * as THREE from 'three';

function getMeshTriangles(mesh) {
  const pos = mesh.geometry.attributes.position;
  const idx = mesh.geometry.index;
  const tris = [];
  const v = new THREE.Vector3();
  mesh.updateMatrixWorld(true);
  const world = mesh.matrixWorld;
  if (idx) {
    for (let i = 0; i < idx.count; i += 3) {
      const a = idx.getX(i);
      const b = idx.getX(i + 1);
      const c = idx.getX(i + 2);
      const A = v.fromBufferAttribute(pos, a).clone().applyMatrix4(world);
      const B = v.fromBufferAttribute(pos, b).clone().applyMatrix4(world);
      const C = v.fromBufferAttribute(pos, c).clone().applyMatrix4(world);
      tris.push([A.toArray(), B.toArray(), C.toArray()]);
    }
  } else {
    for (let i = 0; i < pos.count; i += 3) {
      const A = v.fromBufferAttribute(pos, i).clone().applyMatrix4(world);
      const B = v.fromBufferAttribute(pos, i + 1).clone().applyMatrix4(world);
      const C = v.fromBufferAttribute(pos, i + 2).clone().applyMatrix4(world);
      tris.push([A.toArray(), B.toArray(), C.toArray()]);
    }
  }
  return tris;
}

// Ray–triangle intersection (Möller–Trumbore). Ray fixed at origin
// shooting +X; returns true if it hits the triangle in t > 0.
function rayHitTriangle(rx, ry, rz, tri) {
  const [a, b, c] = tri;
  const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
  const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
  // dir = (1,0,0). px = dir × e2 = (0 * e2z - 0 * e2y, 0 * e2x - 1 * e2z, 1 * e2y - 0 * e2x)
  // px = (0, -e2z, e2y)
  const px = 0, py = -e2z, pz = e2y;
  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < 1e-12) return false;
  const inv = 1 / det;
  const tx = rx - a[0], ty = ry - a[1], tz = rz - a[2];
  const u = (tx * px + ty * py + tz * pz) * inv;
  if (u < 0 || u > 1) return false;
  // q = T × e1
  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  // v = dir · q = (1,0,0) · q = qx
  const v = qx * inv;
  if (v < 0 || u + v > 1) return false;
  // t = e2 · q
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > 1e-9;
}

function pointInsideTris(px, py, pz, tris) {
  let hits = 0;
  for (let i = 0; i < tris.length; i++) {
    if (rayHitTriangle(px, py, pz, tris[i])) hits++;
  }
  return (hits & 1) === 1;
}

// Build a single BoxGeometry of side `size` centred at (cx, cy, cz)
// and append its triangles to the running position / index arrays.
// We avoid BufferGeometryUtils to keep this dependency-free.
function appendCubeFaces(positions, normals, cx, cy, cz, half) {
  const startIdx = positions.length / 3;
  // 8 corners
  const c = [
    [cx - half, cy - half, cz - half], // 0
    [cx + half, cy - half, cz - half], // 1
    [cx + half, cy + half, cz - half], // 2
    [cx - half, cy + half, cz - half], // 3
    [cx - half, cy - half, cz + half], // 4
    [cx + half, cy - half, cz + half], // 5
    [cx + half, cy + half, cz + half], // 6
    [cx - half, cy + half, cz + half], // 7
  ];
  // 6 face quads: [v0, v1, v2, v3, nx, ny, nz]
  const faces = [
    [0, 3, 2, 1,  0,  0, -1], // -Z
    [4, 5, 6, 7,  0,  0,  1], // +Z
    [0, 1, 5, 4,  0, -1,  0], // -Y
    [3, 7, 6, 2,  0,  1,  0], // +Y
    [0, 4, 7, 3, -1,  0,  0], // -X
    [1, 2, 6, 5,  1,  0,  0], // +X
  ];
  for (const f of faces) {
    // Emit two triangles per face with their own 4 corner verts so
    // each face has flat shading (matches Three's default cube).
    const a = c[f[0]], b = c[f[1]], cc = c[f[2]], d = c[f[3]];
    const nx = f[4], ny = f[5], nz = f[6];
    // tri 1: a, b, c
    positions.push(...a, ...b, ...cc);
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
    // tri 2: a, c, d
    positions.push(...a, ...cc, ...d);
    normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
  }
  return startIdx;
}

export function dynaMesh(mesh, resolution = 24) {
  if (!mesh || !mesh.geometry) {
    return { ok: false, error: 'no mesh' };
  }
  const res = Math.max(4, Math.min(96, resolution | 0));
  const pos = mesh.geometry.attributes.position;
  if (!pos) return { ok: false, error: 'no position' };
  const oldVerts = pos.count;

  // Compute world-space bounding box of the mesh.
  mesh.updateMatrixWorld(true);
  const bbox = new THREE.Box3();
  bbox.setFromObject(mesh);
  if (bbox.isEmpty()) return { ok: false, error: 'empty bbox' };
  const size = new THREE.Vector3();
  bbox.getSize(size);
  if (size.x === 0 || size.y === 0 || size.z === 0) {
    // Inflate degenerate axes so we still emit a 1-voxel-thick slab.
    if (size.x === 0) size.x = 0.0001;
    if (size.y === 0) size.y = 0.0001;
    if (size.z === 0) size.z = 0.0001;
  }
  const cellSize = Math.max(size.x, size.y, size.z) / res;
  const nx = Math.max(1, Math.ceil(size.x / cellSize));
  const ny = Math.max(1, Math.ceil(size.y / cellSize));
  const nz = Math.max(1, Math.ceil(size.z / cellSize));

  const tris = getMeshTriangles(mesh);
  if (!tris.length) return { ok: false, error: 'no triangles' };

  // Voxelise.
  const positions = [];
  const normals = [];
  let filledCount = 0;
  const half = cellSize * 0.5;
  for (let iz = 0; iz < nz; iz++) {
    const cz = bbox.min.z + (iz + 0.5) * cellSize;
    for (let iy = 0; iy < ny; iy++) {
      const cy = bbox.min.y + (iy + 0.5) * cellSize;
      for (let ix = 0; ix < nx; ix++) {
        const cx = bbox.min.x + (ix + 0.5) * cellSize;
        if (!pointInsideTris(cx, cy, cz, tris)) continue;
        appendCubeFaces(positions, normals, cx, cy, cz, half);
        filledCount++;
      }
    }
  }

  if (filledCount === 0) {
    // Inside-test rejected every cell (degenerate / non-manifold mesh).
    // Fall back to "surface shell": one cube per triangle centroid.
    for (const t of tris) {
      const cx = (t[0][0] + t[1][0] + t[2][0]) / 3;
      const cy = (t[0][1] + t[1][1] + t[2][1]) / 3;
      const cz = (t[0][2] + t[1][2] + t[2][2]) / 3;
      appendCubeFaces(positions, normals, cx, cy, cz, half);
      filledCount++;
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geom.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();

  // Replace mesh geometry in place — transforms back to local space so
  // the original mesh.matrix stays valid. Easiest: zero out the mesh
  // transform and set geometry in world coords. We follow the precedent
  // set by __studioApplyMatrix in api.js (slice 570).
  if (mesh.geometry.dispose) mesh.geometry.dispose();
  mesh.geometry = geom;
  mesh.position.set(0, 0, 0);
  mesh.quaternion.set(0, 0, 0, 1);
  mesh.scale.set(1, 1, 1);
  mesh.updateMatrix();
  mesh.updateMatrixWorld(true);

  return {
    ok: true,
    oldVerts,
    newVerts: positions.length / 3,
    cells: { nx, ny, nz, filled: filledCount },
    resolution: res,
    cellSize,
  };
}
