// ArchDisc Studio V3 — uniform-grid tetrahedralisation (slice 783).
//
// Builds a volumetric tetrahedral mesh inside a triangle surface mesh's
// AABB by:
//
//   1) Sampling a uniform 3D grid of corner points covering the AABB
//      (padded by half a cell), spacing controlled by `opts.cellSize`
//      or `opts.gridRes` (the longest axis is split into N cells).
//   2) Classifying each grid point as INSIDE the surface or not via
//      a deterministic axis-aligned ray-cast and odd-crossing test
//      (the standard point-in-polyhedron technique used by Houdini's
//      "VDB from polygons" inside/outside check). Three orthogonal
//      rays are cast and the majority vote wins, which makes the test
//      robust against the classic degenerate cases (ray glances a
//      shared edge, ray hits a vertex). When `opts.fillBBox === true`
//      this step is skipped — the entire grid is treated as solid,
//      which is useful for soft-body solver tests on watertight
//      primitives where you simply want the bbox tetrahedralised.
//   3) Emitting tetrahedra for every grid CELL whose 8 corners are
//      ALL inside (the canonical "5-tet split of a cube" — every cube
//      is partitioned into exactly 5 tetrahedra in a way that matches
//      neighbouring cubes' diagonals so the resulting mesh is
//      conforming and water-tight).
//
// The output is a `{ nodes, tets }` pair where `nodes` is a Float32Array
// of length 3*N (XYZ per node) and `tets` is a Uint32Array of length
// 4*T (4 node indices per tetrahedron, ordered so the signed volume
// is POSITIVE — i.e. the standard right-hand-rule orientation the FEM
// solver assumes when it computes the rest inverse).
//
// `nodeIsSurface` is a Uint8Array of length N flagging the nodes that
// sit on (or right next to) the source surface — every node that is
// inside AND has at least one neighbour that is outside. Useful for
// the solver to pin / colour surface nodes differently.
//
// No external dependencies — pure JS. Used by `femsoft/femSolver.js`
// and the install path in `femsoft/index.js`.

import * as THREE from 'three';

// ─── Public ─────────────────────────────────────────────────────────

/**
 * Build a volumetric tetrahedral mesh inside `mesh`'s AABB.
 *
 * @param {THREE.Mesh} mesh
 * @param {Object} opts
 *   @param {number} [opts.cellSize] — uniform cell edge length in world
 *     units. When undefined `opts.gridRes` is used (default 6).
 *   @param {number} [opts.gridRes=6] — number of cells along the
 *     LONGEST AABB axis; the other axes get a proportional count.
 *   @param {boolean} [opts.fillBBox=false] — skip the inside/outside
 *     classification (treat the whole bbox as solid).
 *   @param {number} [opts.padding=0.5] — half-cell padding around the
 *     AABB (in CELL units; 0.5 = half a cell).
 *
 * @returns {Object|null}
 *   { nodes:Float32Array(3*N), tets:Uint32Array(4*T),
 *     nodeIsSurface:Uint8Array(N),
 *     nodeCount:N, tetCount:T,
 *     gridRes:{nx, ny, nz}, cellSize:number,
 *     aabb:{min:[x,y,z], max:[x,y,z]} }
 *   Returns null if the mesh has no geometry, or if the AABB is
 *   degenerate, or if no cells were classified solid.
 */
export function tetrahedralize(mesh, opts) {
  const o = opts || {};
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes
      || !mesh.geometry.attributes.position) {
    return null;
  }
  const geom = mesh.geometry;
  geom.computeBoundingBox();
  const bb = geom.boundingBox;
  if (!bb) return null;
  const min = [bb.min.x, bb.min.y, bb.min.z];
  const max = [bb.max.x, bb.max.y, bb.max.z];
  const sx = max[0] - min[0];
  const sy = max[1] - min[1];
  const sz = max[2] - min[2];
  if (sx <= 0 || sy <= 0 || sz <= 0) return null;
  const longest = Math.max(sx, sy, sz);

  // ── Cell size ────────────────────────────────────────────────────
  const gridRes = Math.max(1, Math.floor(+o.gridRes) || 6);
  const cellSize = Number.isFinite(+o.cellSize) && +o.cellSize > 0
    ? +o.cellSize
    : (longest / gridRes);
  const padding = Number.isFinite(+o.padding) ? +o.padding : 0.5;

  // ── Grid dims (cells along each axis; corners per axis = cells+1)
  const nx = Math.max(1, Math.ceil(sx / cellSize));
  const ny = Math.max(1, Math.ceil(sy / cellSize));
  const nz = Math.max(1, Math.ceil(sz / cellSize));
  const cx = nx + 1;
  const cy = ny + 1;
  const cz = nz + 1;
  const cornerCount = cx * cy * cz;

  // ── Corner positions ─────────────────────────────────────────────
  // Centre the grid on the AABB centre, so half-cell padding is
  // symmetric on both sides of every axis.
  const ox = (min[0] + max[0]) * 0.5 - (nx * cellSize * 0.5);
  const oy = (min[1] + max[1]) * 0.5 - (ny * cellSize * 0.5);
  const oz = (min[2] + max[2]) * 0.5 - (nz * cellSize * 0.5);

  const corners = new Float32Array(cornerCount * 3);
  for (let kz = 0; kz < cz; kz++) {
    for (let ky = 0; ky < cy; ky++) {
      for (let kx = 0; kx < cx; kx++) {
        const ci = (kz * cy + ky) * cx + kx;
        corners[ci * 3]     = ox + kx * cellSize;
        corners[ci * 3 + 1] = oy + ky * cellSize;
        corners[ci * 3 + 2] = oz + kz * cellSize;
      }
    }
  }

  // ── Inside / outside classification ──────────────────────────────
  const fillBBox = !!o.fillBBox;
  const inside = new Uint8Array(cornerCount);
  if (fillBBox) {
    for (let i = 0; i < cornerCount; i++) inside[i] = 1;
  } else {
    // Build a triangle list in world space (or local? mesh.geometry
    // positions are already local; we test against local so no need
    // for mesh.updateMatrixWorld — but the bbox above is local too).
    const tris = _collectTriangles(geom);
    if (!tris) return null;
    // Three orthogonal rays — majority vote. Picking primary axes
    // because they hit the standard degeneracies cleanly: a glancing
    // hit on +X is unlikely to also glance on +Y AND +Z.
    const rayDirs = [[1, 0.0001, 0.0001], [0.0001, 1, 0.0001], [0.0001, 0.0001, 1]];
    for (let i = 0; i < cornerCount; i++) {
      const px = corners[i * 3], py = corners[i * 3 + 1], pz = corners[i * 3 + 2];
      let votes = 0;
      for (let r = 0; r < 3; r++) {
        if (_pointInMesh(px, py, pz, rayDirs[r], tris)) votes++;
      }
      inside[i] = (votes >= 2) ? 1 : 0;
    }
  }

  // ── Solid cells ──────────────────────────────────────────────────
  // A cell is solid when all 8 corners are inside. Pad: a corner that
  // is on the very edge of the surface (i.e. it's INSIDE but it has
  // a neighbour cell that's OUTSIDE) is flagged as `nodeIsSurface`.
  function cornerIdx(kx, ky, kz) { return (kz * cy + ky) * cx + kx; }
  const cellSolid = new Uint8Array(nx * ny * nz);
  let solidCount = 0;
  for (let kz = 0; kz < nz; kz++) {
    for (let ky = 0; ky < ny; ky++) {
      for (let kx = 0; kx < nx; kx++) {
        const all =
          inside[cornerIdx(kx, ky, kz)] &
          inside[cornerIdx(kx + 1, ky, kz)] &
          inside[cornerIdx(kx, ky + 1, kz)] &
          inside[cornerIdx(kx + 1, ky + 1, kz)] &
          inside[cornerIdx(kx, ky, kz + 1)] &
          inside[cornerIdx(kx + 1, ky, kz + 1)] &
          inside[cornerIdx(kx, ky + 1, kz + 1)] &
          inside[cornerIdx(kx + 1, ky + 1, kz + 1)];
        const idx = (kz * ny + ky) * nx + kx;
        cellSolid[idx] = all ? 1 : 0;
        if (all) solidCount++;
      }
    }
  }
  if (solidCount === 0) return null;

  // ── Compact: collect only the corners that touch a solid cell. ────
  const cornerToNode = new Int32Array(cornerCount);
  for (let i = 0; i < cornerCount; i++) cornerToNode[i] = -1;
  let nodeCount = 0;
  const usedNodeIdx = [];
  for (let kz = 0; kz < nz; kz++) {
    for (let ky = 0; ky < ny; ky++) {
      for (let kx = 0; kx < nx; kx++) {
        const idx = (kz * ny + ky) * nx + kx;
        if (!cellSolid[idx]) continue;
        const c0 = cornerIdx(kx, ky, kz);
        const c1 = cornerIdx(kx + 1, ky, kz);
        const c2 = cornerIdx(kx, ky + 1, kz);
        const c3 = cornerIdx(kx + 1, ky + 1, kz);
        const c4 = cornerIdx(kx, ky, kz + 1);
        const c5 = cornerIdx(kx + 1, ky, kz + 1);
        const c6 = cornerIdx(kx, ky + 1, kz + 1);
        const c7 = cornerIdx(kx + 1, ky + 1, kz + 1);
        for (const c of [c0, c1, c2, c3, c4, c5, c6, c7]) {
          if (cornerToNode[c] < 0) {
            cornerToNode[c] = nodeCount++;
            usedNodeIdx.push(c);
          }
        }
      }
    }
  }
  const nodes = new Float32Array(nodeCount * 3);
  for (let n = 0; n < nodeCount; n++) {
    const c = usedNodeIdx[n];
    nodes[n * 3]     = corners[c * 3];
    nodes[n * 3 + 1] = corners[c * 3 + 1];
    nodes[n * 3 + 2] = corners[c * 3 + 2];
  }

  // ── Tetrahedralise every solid cell into 5 tets ──────────────────
  // Canonical "alternating" 5-tet split: cubes at parity (kx+ky+kz)%2
  // are split one way, the rest the other way, so opposing faces match
  // and the global mesh is conforming. Each pattern is { center +
  // 4 corner-trios } where the centre tet is the inner-axis tet.
  //
  // Corner numbering follows the Marching Cubes / Bourke convention:
  //   c0: (0,0,0) c1: (1,0,0) c2: (0,1,0) c3: (1,1,0)
  //   c4: (0,0,1) c5: (1,0,1) c6: (0,1,1) c7: (1,1,1)
  //
  // Pattern A (even parity): tets {0,1,2,4} {1,3,2,7} {1,4,5,7}
  //                              {2,4,6,7} {1,2,4,7}
  // Pattern B (odd parity):  tets {0,1,3,5} {0,2,3,6} {0,4,5,6}
  //                              {3,5,6,7} {0,3,5,6}
  const patternA = [
    [0, 1, 2, 4], [1, 3, 2, 7], [1, 4, 5, 7],
    [2, 4, 6, 7], [1, 2, 4, 7],
  ];
  const patternB = [
    [0, 1, 3, 5], [0, 2, 3, 6], [0, 4, 5, 6],
    [3, 5, 6, 7], [0, 3, 5, 6],
  ];
  const tetsList = [];
  for (let kz = 0; kz < nz; kz++) {
    for (let ky = 0; ky < ny; ky++) {
      for (let kx = 0; kx < nx; kx++) {
        const idx = (kz * ny + ky) * nx + kx;
        if (!cellSolid[idx]) continue;
        const cc = [
          cornerIdx(kx, ky, kz),
          cornerIdx(kx + 1, ky, kz),
          cornerIdx(kx, ky + 1, kz),
          cornerIdx(kx + 1, ky + 1, kz),
          cornerIdx(kx, ky, kz + 1),
          cornerIdx(kx + 1, ky, kz + 1),
          cornerIdx(kx, ky + 1, kz + 1),
          cornerIdx(kx + 1, ky + 1, kz + 1),
        ];
        const parity = (kx + ky + kz) & 1;
        const pat = parity === 0 ? patternA : patternB;
        for (const t of pat) {
          // Map cube-corner-index → node index, then re-orient so
          // signed volume is positive.
          const a = cornerToNode[cc[t[0]]];
          const b = cornerToNode[cc[t[1]]];
          const c = cornerToNode[cc[t[2]]];
          const d = cornerToNode[cc[t[3]]];
          const v = _signedVolume(nodes, a, b, c, d);
          if (v > 0) {
            tetsList.push(a, b, c, d);
          } else if (v < 0) {
            // Swap two to flip orientation.
            tetsList.push(a, b, d, c);
          }
          // v === 0 → degenerate tet, drop it (shouldn't happen on a
          // uniform grid but it's a cheap guard).
        }
      }
    }
  }
  const tets = new Uint32Array(tetsList);
  const tetCount = tets.length / 4;

  // ── Surface flagging ─────────────────────────────────────────────
  // A node is "surface" if its corner had at least one neighbour cell
  // that wasn't solid (i.e. it sits on the boundary of the meshed
  // region). 26-neighbourhood.
  const nodeIsSurface = new Uint8Array(nodeCount);
  for (let n = 0; n < nodeCount; n++) {
    const c = usedNodeIdx[n];
    // Decode corner index back to (kx, ky, kz)
    const kx = c % cx;
    const ky = Math.floor(c / cx) % cy;
    const kz = Math.floor(c / (cx * cy));
    // Each corner sits at the meeting point of up to 8 cells:
    //   cells (kx-1..kx) × (ky-1..ky) × (kz-1..kz)
    let exposed = 0;
    for (let dz = -1; dz <= 0; dz++) {
      for (let dy = -1; dy <= 0; dy++) {
        for (let dx = -1; dx <= 0; dx++) {
          const ckx = kx + dx, cky = ky + dy, ckz = kz + dz;
          if (ckx < 0 || cky < 0 || ckz < 0 || ckx >= nx || cky >= ny || ckz >= nz) {
            exposed = 1; // outside the grid → boundary
          } else {
            const ci = (ckz * ny + cky) * nx + ckx;
            if (!cellSolid[ci]) exposed = 1;
          }
        }
      }
    }
    nodeIsSurface[n] = exposed;
  }

  return {
    nodes,
    tets,
    nodeIsSurface,
    nodeCount,
    tetCount,
    gridRes: { nx, ny, nz },
    cellSize,
    aabb: { min, max },
  };
}

// ─── Helpers ────────────────────────────────────────────────────────

// Build a flat Float32Array of triangle vertex positions: 9 floats per
// triangle (a0,a1,a2,b0,b1,b2,c0,c1,c2), in the geometry's local frame.
function _collectTriangles(geom) {
  const pos = geom.attributes.position;
  if (!pos) return null;
  const idx = geom.index ? geom.index.array : null;
  const triCount = idx ? Math.floor(idx.length / 3) : Math.floor(pos.count / 3);
  if (triCount === 0) return null;
  const out = new Float32Array(triCount * 9);
  for (let t = 0; t < triCount; t++) {
    let a, b, c;
    if (idx) {
      a = idx[t * 3]; b = idx[t * 3 + 1]; c = idx[t * 3 + 2];
    } else {
      a = t * 3; b = t * 3 + 1; c = t * 3 + 2;
    }
    out[t * 9]     = pos.getX(a); out[t * 9 + 1] = pos.getY(a); out[t * 9 + 2] = pos.getZ(a);
    out[t * 9 + 3] = pos.getX(b); out[t * 9 + 4] = pos.getY(b); out[t * 9 + 5] = pos.getZ(b);
    out[t * 9 + 6] = pos.getX(c); out[t * 9 + 7] = pos.getY(c); out[t * 9 + 8] = pos.getZ(c);
  }
  return out;
}

// Möller-Trumbore single-ray-vs-triangle. Returns 1 if the ray from
// (px,py,pz) in direction (dx,dy,dz) hits the triangle on its forward
// side (t > eps), else 0. Hits at t ≤ eps are rejected (so the point
// itself never counts as inside its own boundary).
function _rayHit(px, py, pz, dx, dy, dz,
                 ax, ay, az, bx, by, bz, cx, cy, cz) {
  const eps = 1e-9;
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  // h = d × e2
  const hx = dy * e2z - dz * e2y;
  const hy = dz * e2x - dx * e2z;
  const hz = dx * e2y - dy * e2x;
  const a = e1x * hx + e1y * hy + e1z * hz;
  if (a > -eps && a < eps) return 0;
  const f = 1 / a;
  const sx = px - ax, sy = py - ay, sz = pz - az;
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return 0;
  // q = s × e1
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = f * (dx * qx + dy * qy + dz * qz);
  if (v < 0 || u + v > 1) return 0;
  const t = f * (e2x * qx + e2y * qy + e2z * qz);
  return t > eps ? 1 : 0;
}

// Cast a ray from (px,py,pz) in direction `dir` against every triangle
// in `tris` (flat 9-floats-per-tri array). Odd-crossings → inside.
function _pointInMesh(px, py, pz, dir, tris) {
  const dx = dir[0], dy = dir[1], dz = dir[2];
  const triCount = tris.length / 9;
  let hits = 0;
  for (let t = 0; t < triCount; t++) {
    hits += _rayHit(
      px, py, pz, dx, dy, dz,
      tris[t * 9], tris[t * 9 + 1], tris[t * 9 + 2],
      tris[t * 9 + 3], tris[t * 9 + 4], tris[t * 9 + 5],
      tris[t * 9 + 6], tris[t * 9 + 7], tris[t * 9 + 8],
    );
  }
  return (hits & 1) === 1;
}

// Signed volume of the tetrahedron (a, b, c, d) using node indices.
// > 0 → right-handed, < 0 → left-handed, == 0 → degenerate.
function _signedVolume(nodes, a, b, c, d) {
  const ax = nodes[a * 3], ay = nodes[a * 3 + 1], az = nodes[a * 3 + 2];
  const bx = nodes[b * 3], by = nodes[b * 3 + 1], bz = nodes[b * 3 + 2];
  const cx = nodes[c * 3], cy = nodes[c * 3 + 1], cz = nodes[c * 3 + 2];
  const dx = nodes[d * 3], dy = nodes[d * 3 + 1], dz = nodes[d * 3 + 2];
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const e3x = dx - ax, e3y = dy - ay, e3z = dz - az;
  // (e1 × e2) · e3 / 6
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  return (nx * e3x + ny * e3y + nz * e3z) / 6;
}

// Re-exported for the FEM solver — same convention, exported under a
// stable name so the solver can sanity-check tet volumes after a step.
export function signedTetVolume(nodes, a, b, c, d) {
  return _signedVolume(nodes, a, b, c, d);
}

// Silence the unused-import warning for THREE in some lint configs —
// the public type doc references THREE.Mesh.
export const __THREE_HANDLE = THREE;
