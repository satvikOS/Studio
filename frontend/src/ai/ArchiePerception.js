/*
 * Archie perception — the "read your own work and score it against the
 * reference" step of the autonomous loop.
 *
 * Deterministic, dependency-free perceptual comparison (an aHash-style grid
 * fingerprint): downscale both images to a grid of cells, average each cell's
 * RGB + luminance, and compare the fingerprints. Returns a similarity in
 * [0,1] (1 = identical). Pixel extraction is done by the caller (a canvas in
 * the Electron renderer); these helpers are pure so they import + unit-test
 * in node too.
 *
 * This is what lets Archie chase VISUAL 1:1 parity: build -> capture render ->
 * compare to the reference -> feed the score into the critique -> iterate
 * non-stop until the render matches.
 */

// Build a per-cell fingerprint from RGBA pixels (Uint8ClampedArray, w*h*4).
// Each cell stores [r, g, b, luminance] averaged over the cell's pixels.
export function gridSignature(pixels, w, h, grid = 32) {
  const sig = new Float32Array(grid * grid * 4);
  const cw = w / grid, ch = h / grid;
  for (let gy = 0; gy < grid; gy++) {
    for (let gx = 0; gx < grid; gx++) {
      const x0 = Math.floor(gx * cw), x1 = Math.max(x0 + 1, Math.floor((gx + 1) * cw));
      const y0 = Math.floor(gy * ch), y1 = Math.max(y0 + 1, Math.floor((gy + 1) * ch));
      let r = 0, g = 0, b = 0, n = 0;
      for (let y = y0; y < y1 && y < h; y++) {
        for (let x = x0; x < x1 && x < w; x++) {
          const i = (y * w + x) * 4;
          r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; n++;
        }
      }
      if (!n) n = 1;
      r /= n; g /= n; b /= n;
      const o = (gy * grid + gx) * 4;
      sig[o] = r; sig[o + 1] = g; sig[o + 2] = b; sig[o + 3] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }
  return sig;
}

// Similarity 0..1 between two signatures.
//
// Studio renders are small, high-contrast objects on a near-black OLED
// background, captured live — so the metric must do two things at once:
//   - DISCRIMINATE different scenes (a plain mean-abs-diff is swamped by the
//     huge identical dark background — everything scores ~0.97), and
//   - TOLERATE the sub-pixel / anti-aliasing jitter between two renders of the
//     SAME scene (a pure relative diff is over-sensitive — a 1px shift of a
//     thin bright object moves its lit pixels across cells and tanks the
//     score, so an identical rebuild scored only ~0.74).
//
// So we blend two complementary terms:
//   structural — normalized cross-correlation (NCC) of the per-cell luminance
//     map. Zero-mean + unit-variance, so it is invariant to overall brightness
//     and small shifts/contrast changes (the dark background folds into the
//     mean and drops out), and it correlates STRUCTURE. NCC in [-1,1] -> [0,1].
//   color — a Sorensen relative RGB difference: cells dark in both images add
//     ~0 to numerator and denominator, so only lit geometry drives the hue/
//     value comparison. Background-robust.
export function compareSignatures(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  const n = a.length / 4;
  let ma = 0, mb = 0;
  for (let i = 0; i < a.length; i += 4) { ma += a[i + 3]; mb += b[i + 3]; }
  ma /= n; mb /= n;
  let cov = 0, va = 0, vb = 0, num = 0, den = 0;
  for (let i = 0; i < a.length; i += 4) {
    const la = a[i + 3] - ma, lb = b[i + 3] - mb;
    cov += la * lb; va += la * la; vb += lb * lb;
    num += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    den += (a[i] + b[i]) + (a[i + 1] + b[i + 1]) + (a[i + 2] + b[i + 2]);
  }
  const ncc = (va > 1e-6 && vb > 1e-6) ? cov / Math.sqrt(va * vb)
    : ((va <= 1e-6 && vb <= 1e-6) ? 1 : 0); // both flat => identical structure
  const structural = (ncc + 1) / 2;          // [0,1]
  const color = den > 1e-6 ? 1 - num / den : 1; // [0,1], 1 when both empty
  return Math.max(0, Math.min(1, 0.6 * structural + 0.4 * color));
}

// Convenience: score two RGBA frames directly.
export function perceptualScore(framePixels, frameW, frameH, refPixels, refW, refH, grid = 32) {
  const a = gridSignature(framePixels, frameW, frameH, grid);
  const b = gridSignature(refPixels, refW, refH, grid);
  return compareSignatures(a, b);
}
