// Slice 785 — semi-Lagrangian advection on the slice-751 sparse VDB store.
//
// Scalar field `f(x)` is transported along a velocity field `u(x)` by
// the classic Stam (1999) "Stable Fluids" backtrace:
//
//     f_{n+1}(x) = f_n(x - u(x) * dt)
//
// The backtraced sample is read by trilinear interpolation from the OLD
// field, so the update is unconditionally stable for any dt (the
// CFL-style restriction is on accuracy, not on stability — that's the
// whole point of semi-Lagrangian advection vs. forward Euler upwind).
//
// We restrict the update to ACTIVE TILES of the input field — voxels
// that don't have an allocated tile are zero and a backtrace pulling
// from zero still writes zero, so skipping them is exact for a
// vanishing-at-infinity scalar. The velocity field is stored as three
// sparse VDB stores named `${velocityName}.x` / `.y` / `.z`; any missing
// component is treated as zero (no flow on that axis).
//
// Output is written into a SECOND store; we must not read-after-write
// during the same pass because that would couple downwind voxels to the
// already-updated upwind voxels. The op-surface API takes the output
// store, swaps tiles back into the input store, and frees the temp —
// `__studioVDBAdvect` therefore mutates `name` in-place.

import { SparseVDB } from '../volume/sparseVDB.js';

// Trilinear sample at floating-point world coords.
function _sampleTrilinear(store, x, y, z) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const fx = x - x0;
  const fy = y - y0;
  const fz = z - z0;
  const c000 = store.get(x0,     y0,     z0);
  const c100 = store.get(x0 + 1, y0,     z0);
  const c010 = store.get(x0,     y0 + 1, z0);
  const c110 = store.get(x0 + 1, y0 + 1, z0);
  const c001 = store.get(x0,     y0,     z0 + 1);
  const c101 = store.get(x0 + 1, y0,     z0 + 1);
  const c011 = store.get(x0,     y0 + 1, z0 + 1);
  const c111 = store.get(x0 + 1, y0 + 1, z0 + 1);
  const ix1 = c000 * (1 - fx) + c100 * fx;
  const ix2 = c010 * (1 - fx) + c110 * fx;
  const ix3 = c001 * (1 - fx) + c101 * fx;
  const ix4 = c011 * (1 - fx) + c111 * fx;
  const iy1 = ix1 * (1 - fy) + ix2 * fy;
  const iy2 = ix3 * (1 - fy) + ix4 * fy;
  return iy1 * (1 - fz) + iy2 * fz;
}

// One semi-Lagrangian step. `dt` may be any positive number; large
// values trade temporal accuracy for fewer steps without ever blowing up.
//
// Returns {ok, voxelsWritten}. The output store is freshly allocated by
// the caller; we don't clear() it ourselves so the caller can chain.
export function advectSemiLagrangian(srcStore, dstStore, vx, vy, vz, dt) {
  if (!srcStore || !dstStore) return { ok: false, error: 'src/dst required' };
  const _dt = Number(dt) || 0;
  if (_dt === 0) {
    // Zero-dt advection is identity. Copy active voxels directly so the
    // dst tile topology mirrors src without a numeric walk.
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
            if (v !== 0) {
              dstStore.set(baseX + lx, baseY + ly, baseZ + lz, v);
              n++;
            }
          }
        }
      }
    });
    return { ok: true, voxelsWritten: n, dt: 0 };
  }
  let voxelsWritten = 0;
  srcStore.forEachActiveTile((tile) => {
    const ts = srcStore.tileSize;
    const baseX = tile.tx * ts;
    const baseY = tile.ty * ts;
    const baseZ = tile.tz * ts;
    for (let lz = 0; lz < ts; lz++) {
      for (let ly = 0; ly < ts; ly++) {
        for (let lx = 0; lx < ts; lx++) {
          const x = baseX + lx;
          const y = baseY + ly;
          const z = baseZ + lz;
          const ux = vx ? vx.get(x, y, z) : 0;
          const uy = vy ? vy.get(x, y, z) : 0;
          const uz = vz ? vz.get(x, y, z) : 0;
          // Backtrace.
          const bx = x - ux * _dt;
          const by = y - uy * _dt;
          const bz = z - uz * _dt;
          const v = _sampleTrilinear(srcStore, bx, by, bz);
          if (v !== 0) {
            dstStore.set(x, y, z, v);
            voxelsWritten++;
          }
        }
      }
    }
  });
  return { ok: true, voxelsWritten, dt: _dt };
}

// In-place advection helper: builds a temp dst store, runs advection,
// then swaps the tile map of dst back into src. Used by the
// `__studioVDBAdvect` op so callers don't have to manage scratch
// storage.
export function advectInPlace(srcStore, vx, vy, vz, dt) {
  const tmp = new SparseVDB('__vdb_advect_tmp__', srcStore.tileSize);
  const r = advectSemiLagrangian(srcStore, tmp, vx, vy, vz, dt);
  if (!r.ok) return r;
  // Replace src tile map with tmp's. SparseVDB exposes `tiles` and an
  // internal `_activeVoxelCount` — we move both.
  srcStore.tiles = tmp.tiles;
  srcStore._activeVoxelCount = tmp._activeVoxelCount;
  return r;
}
