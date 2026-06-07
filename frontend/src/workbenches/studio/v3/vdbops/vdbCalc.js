// Slice 785 — sparse-VDB vector calculus operators (gradient + divergence).
//
// Gradient of a scalar field f produces a vector field ∇f. We compute
// it with second-order central differences:
//
//     (∂f / ∂x)_{x,y,z} = (f_{x+1,y,z} - f_{x-1,y,z}) / 2
//     (analogous for ∂y, ∂z)
//
// Divergence of a vector field u = (u_x, u_y, u_z) produces a scalar
// field ∇·u, again with central differences:
//
//     (∇·u)_{x,y,z} = (u_x_{x+1,y,z} - u_x_{x-1,y,z}) / 2
//                   + (u_y_{x,y+1,z} - u_y_{x,y-1,z}) / 2
//                   + (u_z_{x,y,z+1} - u_z_{x,y,z-1}) / 2
//
// Both ops are FIRST-ORDER ACCURATE (forward / backward differences) on
// the boundary of the active topology where reading across a tile edge
// pulls a zero from an unallocated tile; this matches OpenVDB's default
// "extension is zero" behaviour and is what every published Stam-style
// pyro solver does at the grid boundary.
//
// Storage convention:
//   • Gradient writes 3 sparse VDBs: outName.x, outName.y, outName.z.
//     Each is allocated by the caller (vdbops/index.js) prior to entry.
//   • Divergence reads 3 sparse VDBs: name.x, name.y, name.z. Missing
//     components are treated as zero (no contribution to that partial).

// Central difference along the chosen axis. Step size is 1 voxel; we
// don't fold dx into the formula because the sparse grid is unitless —
// downstream consumers can rescale.
function _centralDiff(store, x, y, z, axis) {
  let xp = x, yp = y, zp = z;
  let xm = x, ym = y, zm = z;
  if (axis === 0) { xp = x + 1; xm = x - 1; }
  else if (axis === 1) { yp = y + 1; ym = y - 1; }
  else                 { zp = z + 1; zm = z - 1; }
  const a = store.get(xp, yp, zp);
  const b = store.get(xm, ym, zm);
  return 0.5 * (a - b);
}

// Public: gradient. Reads `src`, writes into the three pre-allocated
// `dstX` / `dstY` / `dstZ` stores. Visits every active voxel of src
// plus the 1-voxel boundary around it (gradients can be nonzero at the
// boundary of the input topology where the central difference picks up
// an inside-vs-outside step).
//
// Returns {ok, voxelsWritten}.
export function gradient(srcStore, dstX, dstY, dstZ) {
  if (!srcStore || !dstX || !dstY || !dstZ) {
    return { ok: false, error: 'src + 3 dst stores required' };
  }
  // Track the set of (x,y,z) we've already touched so we don't process
  // the same voxel twice when adjacent tiles overlap their crusts.
  const seen = new Set();
  const _touch = (x, y, z) => {
    // Pack into a string key; voxel coords for typical scenes fit in
    // ≤ 21 bits each so a 3-int string stays short.
    const k = x + ',' + y + ',' + z;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };
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
          // Touch the voxel itself + its 6 face neighbours so we catch
          // gradients on the boundary.
          for (let kk = 0; kk < 7; kk++) {
            const ox = kk === 1 ? -1 : kk === 2 ? 1 : 0;
            const oy = kk === 3 ? -1 : kk === 4 ? 1 : 0;
            const oz = kk === 5 ? -1 : kk === 6 ? 1 : 0;
            const xx = x + ox;
            const yy = y + oy;
            const zz = z + oz;
            if (!_touch(xx, yy, zz)) continue;
            const gx = _centralDiff(srcStore, xx, yy, zz, 0);
            const gy = _centralDiff(srcStore, xx, yy, zz, 1);
            const gz = _centralDiff(srcStore, xx, yy, zz, 2);
            if (gx !== 0) dstX.set(xx, yy, zz, gx);
            if (gy !== 0) dstY.set(xx, yy, zz, gy);
            if (gz !== 0) dstZ.set(xx, yy, zz, gz);
            if (gx !== 0 || gy !== 0 || gz !== 0) n++;
          }
        }
      }
    }
  });
  return { ok: true, voxelsWritten: n };
}

// Public: divergence. Reads three component stores, writes scalar into
// `dst`. The component stores may be null/undefined (treated as
// uniformly zero — no contribution on that axis).
//
// Returns {ok, voxelsWritten}.
export function divergence(srcX, srcY, srcZ, dstStore) {
  if (!dstStore) return { ok: false, error: 'dst required' };
  if (!srcX && !srcY && !srcZ) return { ok: false, error: 'at least one src component required' };
  const seen = new Set();
  const _touch = (x, y, z) => {
    const k = x + ',' + y + ',' + z;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  };
  let n = 0;
  const _walk = (store, axis) => {
    if (!store) return;
    store.forEachActiveTile((tile) => {
      const ts = store.tileSize;
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
            // Touch the voxel + its 1-thick crust along the swept axis
            // so the divergence picks up cross-boundary contributions.
            for (let off = -1; off <= 1; off++) {
              let xx = x, yy = y, zz = z;
              if (axis === 0) xx = x + off;
              else if (axis === 1) yy = y + off;
              else                 zz = z + off;
              if (!_touch(xx, yy, zz)) continue;
              const dx = srcX ? _centralDiff(srcX, xx, yy, zz, 0) : 0;
              const dy = srcY ? _centralDiff(srcY, xx, yy, zz, 1) : 0;
              const dz = srcZ ? _centralDiff(srcZ, xx, yy, zz, 2) : 0;
              const div = dx + dy + dz;
              if (div !== 0) {
                dstStore.set(xx, yy, zz, div);
                n++;
              }
            }
          }
        }
      }
    });
  };
  _walk(srcX, 0);
  _walk(srcY, 1);
  _walk(srcZ, 2);
  return { ok: true, voxelsWritten: n };
}
