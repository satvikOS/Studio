// Slice 785 — sparse-VDB Gaussian smoothing via 1D separable passes.
//
// A 3D Gaussian kernel K(x, y, z) factors as K(x) · K(y) · K(z), so we
// can blur in O(W · N) per pass instead of O(W^3 · N) for the naive
// dense 3D kernel — `W` is the kernel half-width and `N` is the active
// voxel count. OpenVDB's `tools::Filter::gaussian` uses the same
// trick: three separable 1D passes, one per axis.
//
// Kernel:
//   K_i = exp(-i² / (2 σ²))    for i ∈ [-W, W]
//   then normalised to sum to 1.
//
// We choose W = ceil(3 σ) so the kernel captures > 99.7 % of the energy
// (3-σ truncation matches the standard convention in OpenVDB / OpenCV).
//
// Each pass writes to a freshly allocated sparse store and replaces the
// input's tile map. The output topology is identical to the input
// topology (Gaussian-blurred zero stays zero); we visit only active
// voxels.

import { SparseVDB } from '../volume/sparseVDB.js';

function _gaussianKernel(sigma) {
  const s = Math.max(0.0001, Number(sigma) || 0);
  const w = Math.max(1, Math.ceil(3 * s));
  const k = new Float32Array(2 * w + 1);
  let sum = 0;
  const inv2s2 = 1 / (2 * s * s);
  for (let i = -w; i <= w; i++) {
    const v = Math.exp(-i * i * inv2s2);
    k[i + w] = v;
    sum += v;
  }
  // Normalise.
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  return { k, w };
}

// One 1D pass along axis ∈ {0:'x', 1:'y', 2:'z'} on the sparse store.
// Returns voxels written.
function _pass1D(srcStore, dstStore, axis, kernel, half) {
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
          const c = d[lx + ly * ts + lz * ts * ts];
          if (c === 0) continue;
          const x = baseX + lx;
          const y = baseY + ly;
          const z = baseZ + lz;
          let acc = 0;
          for (let i = -half; i <= half; i++) {
            const w = kernel[i + half];
            let sx = x, sy = y, sz = z;
            if (axis === 0) sx = x + i;
            else if (axis === 1) sy = y + i;
            else                  sz = z + i;
            acc += srcStore.get(sx, sy, sz) * w;
          }
          if (acc !== 0) {
            dstStore.set(x, y, z, acc);
            n++;
          }
        }
      }
    }
  });
  return n;
}

// Public: Gaussian smooth in place. `sigma` is the standard deviation
// in voxel units; sigma == 0 is a no-op.
//
// Returns {ok, sigma, kernelHalfWidth, passes:[{axis, voxelsWritten}]}
export function smoothGaussian(store, sigma) {
  if (!store) return { ok: false, error: 'store required' };
  const s = Math.max(0, Number(sigma) || 0);
  if (s === 0) return { ok: true, sigma: 0, kernelHalfWidth: 0, passes: [] };
  const { k, w } = _gaussianKernel(s);
  const passes = [];
  let src = store;
  for (let axis = 0; axis < 3; axis++) {
    const dst = new SparseVDB('__vdb_smooth_tmp__', src.tileSize);
    const n = _pass1D(src, dst, axis, k, w);
    passes.push({ axis, voxelsWritten: n });
    src = dst;
  }
  store.tiles = src.tiles;
  store._activeVoxelCount = src._activeVoxelCount;
  return { ok: true, sigma: s, kernelHalfWidth: w, passes };
}
