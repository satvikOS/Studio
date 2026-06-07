// ArchDisc Studio V3 — à-trous wavelet filter for SVGF (slice 891).
//
// Implements the edge-stopping à-trous wavelet pass from Dammertz et al.
// 2010 ("Edge-Avoiding À-Trous Wavelet Transform") as adapted to SVGF
// by Schied et al. 2017. The colour buffer is convolved with a 5×5 B-3
// spline kernel five times with successively-growing stride
// (1, 2, 4, 8, 16) — at each level the kernel skips 2^level − 1 pixels,
// which is what the "à trous" (with holes) name refers to.
//
// Edge-stopping weights are products of three exponentials:
//   w = exp(−|c_i − c_p| / σ_c · sqrt(var))
//     · exp(−|n_i − n_p| / σ_n)
//     · exp(−|z_i − z_p| / σ_d)
//
// where `c` is the per-pixel colour (luma), `n` is the world-space
// normal, and `z` is the per-pixel depth. The variance term in the
// colour weight is the SVGF refinement — it stops the filter from
// over-blurring pixels that are already low-variance (e.g. directly-lit
// surfaces) while letting it aggressively smear high-variance pixels
// (e.g. raw indirect samples).
//
// Pure JS, no deps. Operates on a single luma channel — the SVGF
// orchestrator runs three passes (R, G, B) and recombines.

// 5×5 B-3 spline kernel from Dammertz et al. — the canonical à-trous
// weights every SVGF implementation uses.
export const ATROUS_KERNEL_5x5 = [
  1/256,  4/256,  6/256,  4/256, 1/256,
  4/256, 16/256, 24/256, 16/256, 4/256,
  6/256, 24/256, 36/256, 24/256, 6/256,
  4/256, 16/256, 24/256, 16/256, 4/256,
  1/256,  4/256,  6/256,  4/256, 1/256,
];

export const DEFAULT_STRIDES = [1, 2, 4, 8, 16]; // 5 à-trous levels.

// One à-trous pass.
//
// in: { colour, variance, normal, depth, width, height }
// sigmas: { sigmaColor, sigmaNormal, sigmaDepth }
// stride: power-of-two step between kernel taps.
//
// Returns { colour, variance } — both new Float32Arrays of the same
// W*H size. Variance is filtered with the kernel SQUARED weights so
// the variance estimate stays well-defined (Schied §4.3 — variance
// transforms quadratically through a linear filter).
export function atrousPass({
  colour, variance, normal, depth, width, height,
}, { sigmaColor = 4.0, sigmaNormal = 128.0, sigmaDepth = 1.0 } = {}, stride = 1) {
  const outC = new Float32Array(width * height);
  const outV = new Float32Array(width * height);
  const k = ATROUS_KERNEL_5x5;
  const half = 2; // 5×5

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const cP = colour[i];
      const vP = variance ? variance[i] : 0;
      const dP = depth ? depth[i] : 0;
      let nPx = 0, nPy = 0, nPz = 1;
      if (normal) {
        nPx = normal[i * 3];
        nPy = normal[i * 3 + 1];
        nPz = normal[i * 3 + 2];
      }
      // Per-Schied §4.3, the variance σ for the colour weight uses a
      // tiny 3×3 Gaussian over the variance buffer ("filtered
      // variance"). We approximate it with the centre pixel's σ for
      // speed — variance is itself smoothed at each level.
      const lumaSigma = Math.sqrt(Math.max(vP, 1e-10)) * sigmaColor + 1e-6;

      let sumC = 0, sumV = 0, sumW = 0, sumW2 = 0;
      for (let ky = -half; ky <= half; ky++) {
        const yy = y + ky * stride;
        if (yy < 0 || yy >= height) continue;
        for (let kx = -half; kx <= half; kx++) {
          const xx = x + kx * stride;
          if (xx < 0 || xx >= width) continue;
          const j = yy * width + xx;
          const kw = k[(ky + half) * 5 + (kx + half)];
          const cI = colour[j];
          // Colour edge-stop.
          const wC = Math.exp(-Math.abs(cI - cP) / lumaSigma);
          // Normal edge-stop. Dot product → angle; we use the
          // pow(max(0, n·n'), σ_n) formulation from Schied so the
          // weight collapses smoothly as the angle widens.
          let wN = 1;
          if (normal) {
            const nIx = normal[j * 3];
            const nIy = normal[j * 3 + 1];
            const nIz = normal[j * 3 + 2];
            const dot = Math.max(0, nIx * nPx + nIy * nPy + nIz * nPz);
            wN = Math.pow(dot, sigmaNormal);
          }
          // Depth edge-stop. Distance-relative so far-away geometry
          // doesn't reject due to absolute depth magnitude.
          let wD = 1;
          if (depth) {
            const dI = depth[j];
            // Scale depth difference by the local depth gradient (stride
            // controls how far apart the samples are). Without an actual
            // gradient buffer we approximate via the centre value.
            const denom = sigmaDepth * Math.abs(dP) * stride + 1e-3;
            wD = Math.exp(-Math.abs(dI - dP) / denom);
          }
          const w = kw * wC * wN * wD;
          sumC  += w * cI;
          sumV  += w * w * (variance ? variance[j] : 0);
          sumW  += w;
          sumW2 += w * w;
        }
      }
      if (sumW > 1e-10) {
        outC[i] = sumC / sumW;
        outV[i] = sumW2 > 1e-10 ? sumV / (sumW * sumW) : 0;
      } else {
        outC[i] = cP;
        outV[i] = vP;
      }
    }
  }
  return { colour: outC, variance: outV };
}

// Run all N levels of the à-trous wavelet stack.
//
// Returns { colour, variance } after the final pass.
export function atrousMultiLevel(input, sigmas, strides = DEFAULT_STRIDES) {
  let colour = input.colour;
  let variance = input.variance;
  for (let level = 0; level < strides.length; level++) {
    const res = atrousPass(
      { colour, variance, normal: input.normal, depth: input.depth,
        width: input.width, height: input.height },
      sigmas,
      strides[level],
    );
    colour = res.colour;
    variance = res.variance;
  }
  return { colour, variance };
}

export default {
  atrousPass,
  atrousMultiLevel,
  ATROUS_KERNEL_5x5,
  DEFAULT_STRIDES,
};
