// ArchDisc Studio V3 — SVGF variance estimator (slice 891).
//
// Implements per-pixel variance from the current colour buffer and a
// running history (first + second moments). Mirrors the variance pass
// from Schied et al. 2017 "Spatiotemporal Variance-Guided Filtering"
// (the V in SVGF).
//
// Math:
//   μ  = (1-α)·μ_prev + α·colour       (luma first moment)
//   μ² = (1-α)·μ²_prev + α·colour²     (luma second moment)
//   var = max(0, μ² − μ²)              (per-pixel variance)
//
// When the temporal-history age for a pixel is below a small threshold,
// we fall back to a 7×7 spatial-variance estimate so the first frames
// after a disocclusion still get a meaningful sigma for the à-trous
// pass.
//
// Pure JS, no deps. All buffers are Float32Array sized W*H. RGBA is
// folded into a single luma channel L = 0.2126*R + 0.7152*G + 0.0722*B.

export function luma(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Build the luma buffer from a Uint8ClampedArray (canvas ImageData.data).
export function bufferToLuma(data, width, height) {
  const out = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const j = i * 4;
    out[i] = luma(data[j] / 255, data[j + 1] / 255, data[j + 2] / 255);
  }
  return out;
}

// Temporal moment integrator. `prev` may be null on the very first frame.
//
// state: { mu: Float32Array, mu2: Float32Array, age: Uint16Array, width, height }
export function createMomentState(width, height) {
  return {
    width, height,
    mu:  new Float32Array(width * height),
    mu2: new Float32Array(width * height),
    age: new Uint16Array(width * height),
  };
}

export function updateMoments(state, lumaBuf, alpha) {
  const { mu, mu2, age, width, height } = state;
  const n = width * height;
  // alpha = 0 → fully trust history; alpha = 1 → discard history.
  const a = Math.min(1, Math.max(0, alpha));
  for (let i = 0; i < n; i++) {
    const L = lumaBuf[i];
    mu[i]  = (1 - a) * mu[i]  + a * L;
    mu2[i] = (1 - a) * mu2[i] + a * L * L;
    age[i] = Math.min(0xFFFF, age[i] + 1);
  }
}

export function resetMoments(state) {
  state.mu.fill(0);
  state.mu2.fill(0);
  state.age.fill(0);
}

// Compute per-pixel variance from the moment buffers.
//
// For pixels with age < 4 we use a 7×7 spatial-variance window
// (Schied §4.2 — spatial estimator) so the first frames after a
// disocclusion still get a usable sigma.
export function estimateVariance(state, lumaBuf) {
  const { mu, mu2, age, width, height } = state;
  const n = width * height;
  const variance = new Float32Array(n);
  const halfWin = 3; // 7×7 window
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (age[i] >= 4) {
        const v = mu2[i] - mu[i] * mu[i];
        variance[i] = v > 0 ? v : 0;
      } else {
        // Fall back to spatial sample variance over a 7×7 window.
        let sum = 0, sumSq = 0, cnt = 0;
        for (let dy = -halfWin; dy <= halfWin; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= height) continue;
          for (let dx = -halfWin; dx <= halfWin; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= width) continue;
            const L = lumaBuf[yy * width + xx];
            sum += L;
            sumSq += L * L;
            cnt++;
          }
        }
        if (cnt < 2) { variance[i] = 0; continue; }
        const m = sum / cnt;
        const v = sumSq / cnt - m * m;
        // Schied §4.2: scale up spatial estimate for low-confidence pixels.
        variance[i] = Math.max(0, v) * 4;
      }
    }
  }
  return variance;
}

// Read luma from a dataURL into a Float32 buffer. Returns null on failure.
export function dataUrlToLumaSync(_dataUrl) {
  // Not used directly — the SVGF orchestrator decodes the image once and
  // calls bufferToLuma on the resulting ImageData.data array.
  return null;
}

export default {
  luma,
  bufferToLuma,
  createMomentState,
  updateMoments,
  resetMoments,
  estimateVariance,
};
