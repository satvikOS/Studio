// Slice 785 — sparse-VDB morphological operators (dilate / erode).
//
// Dilate is a 1-voxel max filter over a 3×3×3 neighbourhood; erode is
// the analogous min filter. OpenVDB ships these as `tools::dilateVoxels`
// / `tools::erodeVoxels` and they're how the canonical VDB topology
// grows or shrinks when you need a sealed level set, a smoke domain
// inflated for advection footprint, or a SDF eroded to retract a
// boundary.
//
// Implementation notes:
//   • We use a 6-connected (face-only) neighbourhood for the 1-voxel
//     kernel. This matches OpenVDB's default `NN_FACE` connectivity used
//     by `dilateActiveValues` / `erodeActiveValues` — it grows the
//     active topology by exactly one voxel per iteration in each axis
//     direction. (`NN_FACE_EDGE_VERTEX` is the 26-connected variant; we
//     don't need it here.)
//   • Dilate iterates VOXELS, so we visit every voxel inside every
//     active tile + the one-thick crust of voxels in tiles that
//     neighbour an active tile. Pure VDB semantics: dilate grows
//     topology, erode does not allocate new tiles.
//   • Erode reads the source store and writes zero into voxels whose
//     6-neighbour MIN drops below the source — but the rule for a
//     "binary" erode would be different: drop a voxel if any neighbour
//     is zero. We implement the **scalar** erode (per-voxel min over
//     the kernel) so it remains useful for SDFs and density fields, not
//     just binary masks. For a strict binary erode, set the source to
//     {0, 1} and threshold the output ≥ 1.
//
// Both operators are LEVEL-SET-CORRECT in the limit of small voxel
// sizes; for binary masks they exactly match the morphological
// definition.

import { SparseVDB } from '../volume/sparseVDB.js';

// 6 face-neighbour offsets.
const _N6 = [
  [-1, 0, 0], [1, 0, 0],
  [0, -1, 0], [0, 1, 0],
  [0, 0, -1], [0, 0, 1],
];

// One-voxel dilate (max filter, 6-connected). Active topology can grow:
// a voxel inside a not-yet-allocated tile that neighbours an active
// voxel will be written. We accomplish this by visiting each active
// voxel's 6 face neighbours and propagating its value if greater than
// what's already at the neighbour.
//
// Returns {ok, voxelsWritten}.
function _dilateOnce(srcStore, dstStore) {
  // Seed dst with src so existing values survive.
  let n = 0;
  srcStore.forEachActiveTile((tile) => {
    const ts = srcStore.tileSize;
    const baseX = tile.tx * ts;
    const baseY = tile.ty * ts;
    const baseZ = tile.tz * ts;
    const d = tile.data;
    for (let lz = 0; lz < ts; lz++) {
      for (let ly = 0; ly < ts; ly++) {
        for (let lx = 0; lx < ts; lx++) {
          const v = d[lx + ly * ts + lz * ts * ts];
          if (v === 0) continue;
          const x = baseX + lx;
          const y = baseY + ly;
          const z = baseZ + lz;
          // The voxel itself.
          if (dstStore.get(x, y, z) < v) {
            dstStore.set(x, y, z, v);
            n++;
          }
          // Propagate to 6 neighbours.
          for (let k = 0; k < 6; k++) {
            const nx = x + _N6[k][0];
            const ny = y + _N6[k][1];
            const nz = z + _N6[k][2];
            if (dstStore.get(nx, ny, nz) < v) {
              dstStore.set(nx, ny, nz, v);
              n++;
            }
          }
        }
      }
    }
  });
  return n;
}

// One-voxel erode (min filter, 6-connected). For each active voxel we
// take the min over the 6-neighbour kernel + the voxel itself.
// Zero-neighbours drag the value down. Erode does NOT allocate new
// tiles — the output topology is a SUBSET of the input topology.
function _erodeOnce(srcStore, dstStore) {
  let n = 0;
  srcStore.forEachActiveTile((tile) => {
    const ts = srcStore.tileSize;
    const baseX = tile.tx * ts;
    const baseY = tile.ty * ts;
    const baseZ = tile.tz * ts;
    const d = tile.data;
    for (let lz = 0; lz < ts; lz++) {
      for (let ly = 0; ly < ts; ly++) {
        for (let lx = 0; lx < ts; lx++) {
          const v = d[lx + ly * ts + lz * ts * ts];
          if (v === 0) continue;
          const x = baseX + lx;
          const y = baseY + ly;
          const z = baseZ + lz;
          let m = v;
          for (let k = 0; k < 6; k++) {
            const w = srcStore.get(x + _N6[k][0], y + _N6[k][1], z + _N6[k][2]);
            if (w < m) m = w;
          }
          if (m !== 0) {
            dstStore.set(x, y, z, m);
            n++;
          }
        }
      }
    }
  });
  return n;
}

// Public: N-step dilate, in place. Pure-iteration loop — each pass
// reads from the prior pass's full topology, so propagation is correct
// across tile boundaries.
//
// Returns {ok, iterations, voxelsWritten}.
export function dilate(store, voxels) {
  if (!store) return { ok: false, error: 'store required' };
  const n = Math.max(0, Math.floor(Number(voxels) || 0));
  if (n === 0) return { ok: true, iterations: 0, voxelsWritten: 0 };
  let total = 0;
  let src = store;
  for (let i = 0; i < n; i++) {
    const dst = new SparseVDB('__vdb_dilate_tmp__', src.tileSize);
    total += _dilateOnce(src, dst);
    src = dst;
  }
  // Swap dst back into store.
  store.tiles = src.tiles;
  store._activeVoxelCount = src._activeVoxelCount;
  return { ok: true, iterations: n, voxelsWritten: total };
}

// Public: N-step erode, in place.
//
// Returns {ok, iterations, voxelsWritten}.
export function erode(store, voxels) {
  if (!store) return { ok: false, error: 'store required' };
  const n = Math.max(0, Math.floor(Number(voxels) || 0));
  if (n === 0) return { ok: true, iterations: 0, voxelsWritten: 0 };
  let total = 0;
  let src = store;
  for (let i = 0; i < n; i++) {
    const dst = new SparseVDB('__vdb_erode_tmp__', src.tileSize);
    total += _erodeOnce(src, dst);
    src = dst;
  }
  store.tiles = src.tiles;
  store._activeVoxelCount = src._activeVoxelCount;
  return { ok: true, iterations: n, voxelsWritten: total };
}
