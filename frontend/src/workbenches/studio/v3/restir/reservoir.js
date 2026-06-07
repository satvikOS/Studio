// ArchDisc Studio V3 — ReSTIR per-pixel reservoir (slice 792).
//
// Reservoir Spatio-Temporal Importance Resampling (Bitterli et al. 2020,
// "Spatiotemporal reservoir resampling for real-time ray tracing with
// dynamic direct lighting"). Streaming Weighted Reservoir Sampling
// (Algorithm A-Chao / WRS) keeps a single chosen light + an aggregate
// weight per pixel; spatial + temporal reuse exchange reservoirs between
// neighbouring pixels and across frames to dramatically reduce variance
// at <1 sample per pixel.
//
// A reservoir holds:
//   • y      — the candidate sample currently in the reservoir (a {lightIdx,
//              p, ...} object). null until the first stream() call.
//   • wSum   — running sum of target-pdf-weighted source weights p̂(x)/p(x).
//   • M      — total number of candidates streamed (deterministic count,
//              used by the temporal reuse M-cap rule).
//   • W      — unbiased contribution weight W = wSum / (M · p̂(y)) computed
//              by finalize(). Zero until finalize() is called.
//   • pHat   — the target-function value p̂(y) at the chosen sample.
//
// This is a pure-data module — no THREE, no DOM, no globals — so the
// reservoir math can be unit-checked independently of the sampler.

const EPS = 1e-12;

// ─── Reservoir lifecycle ─────────────────────────────────────────────────

/** Build a fresh empty reservoir. */
export function createReservoir() {
  return {
    y: null,    // chosen candidate sample (object) — null until stream()
    wSum: 0,    // streaming weight sum Σ w_i
    M: 0,       // total candidates considered (incremented per stream())
    W: 0,       // unbiased contribution weight (set by finalize())
    pHat: 0,    // target-pdf value at y (cached so spatial reuse is cheap)
  };
}

/** Zero a reservoir in place. Used to "clear" without re-allocating. */
export function resetReservoir(r) {
  if (!r) return;
  r.y = null;
  r.wSum = 0;
  r.M = 0;
  r.W = 0;
  r.pHat = 0;
}

// ─── Streaming Weighted Reservoir Sampling ───────────────────────────────
//
// stream(reservoir, candidate, weight, pHat, rng) — classic Chao A-Res /
// Bitterli algorithm 2. Replaces y with the new candidate with probability
//   weight / (wSum + weight)
// after which wSum += weight and M += 1.
//
// `pHat` is the target-function value at the candidate, stored on the
// reservoir whenever the candidate becomes the new y. Combined reservoirs
// use it (cached) instead of re-evaluating p̂ for the spatial reuse pass.
export function streamReservoir(r, candidate, weight, pHat, rng) {
  if (!r) return false;
  const w = Math.max(0, +weight);
  r.M += 1;
  if (w <= 0) return false;
  r.wSum += w;
  // Replace y with the new candidate w/ prob w/wSum.
  const u = rng();
  if (r.y === null || u < w / r.wSum) {
    r.y = candidate;
    r.pHat = +pHat;
    return true;
  }
  return false;
}

// ─── Reservoir combine (spatial / temporal reuse) ────────────────────────
//
// combineReservoirs(dst, src, rngSample) — combines reservoir `src` into
// `dst` treating src.y as a single candidate with weight
//   p̂_dst(src.y) · src.W · src.M
// per Bitterli equation 6. The destination's pHat is the *destination's*
// target-pdf evaluation at the chosen sample — provided by the caller via
// `pHatFn(sample) → number` because that depends on the destination's
// surface normal/position.
//
// The combined reservoir's M is increased by src.M so the M-cap rule
// applies correctly when chaining temporal + spatial passes.
export function combineReservoirs(dst, src, pHatFn, rng) {
  if (!dst || !src || !src.y) return false;
  const pHatAtDst = +pHatFn(src.y);
  if (!(pHatAtDst > 0)) {
    // Sample is shadowed / behind the surface at destination — just
    // accumulate M so it counts toward the candidate count.
    dst.M += src.M;
    return false;
  }
  const w = pHatAtDst * src.W * src.M;
  const ok = streamReservoir(dst, src.y, w, pHatAtDst, rng);
  // streamReservoir already incremented M by 1; reuse needs M += src.M-1
  // more so the total reflects the full reused population.
  if (src.M > 1) dst.M += (src.M - 1);
  return ok;
}

// ─── Finalisation — compute unbiased contribution weight W ───────────────
//
// W = wSum / (M · p̂(y)) (Bitterli eq. 5). Called once per reservoir before
// shading, so subsequent reuse passes can multiply by W directly without
// re-deriving it. Returns 0 (and clears y) when the reservoir is empty
// or numerically degenerate so callers can safely skip the shading.
export function finalizeReservoir(r) {
  if (!r) return 0;
  if (!r.y || r.M <= 0 || r.pHat <= EPS) {
    r.W = 0;
    return 0;
  }
  r.W = r.wSum / (r.M * r.pHat);
  if (!isFinite(r.W) || r.W < 0) r.W = 0;
  return r.W;
}

// ─── Temporal M-cap ──────────────────────────────────────────────────────
//
// Bitterli §5.4 caps the temporal reservoir's M to ≈20× the per-frame
// candidate budget so old reservoirs don't permanently dominate the
// statistic when the scene/lighting changes. We follow their default of
// 20× and clamp wSum proportionally so the W estimator stays consistent
// (W = wSum / (M · p̂) — clamping M alone would bias W upward).
export function capReservoirM(r, mCap) {
  if (!r || mCap <= 0) return;
  if (r.M <= mCap) return;
  const scale = mCap / r.M;
  r.wSum *= scale;
  r.M = mCap;
}

// ─── Reservoir grid (per-pixel arrays) ───────────────────────────────────
//
// A grid is just `width × height` parallel arrays of reservoir state.
// We use parallel typed arrays (instead of a JS array of objects) so the
// spatial-reuse loop is cache-friendly: hot reads/writes hit contiguous
// memory, no GC pressure, no per-pixel object allocations.
//
// Light candidates referenced by y are *indices* into the sampler's light
// table — never object references — so we can stuff the chosen-y into a
// plain Int32Array.

export function createReservoirGrid(width, height) {
  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  const n = w * h;
  return {
    width: w,
    height: h,
    count: n,
    yIdx: new Int32Array(n),    // chosen light index (or -1)
    wSum: new Float32Array(n),
    M: new Float32Array(n),
    W: new Float32Array(n),
    pHat: new Float32Array(n),
  };
}

export function resetGrid(g) {
  if (!g) return;
  g.yIdx.fill(-1);
  g.wSum.fill(0);
  g.M.fill(0);
  g.W.fill(0);
  g.pHat.fill(0);
}

export function gridGet(g, x, y) {
  const i = y * g.width + x;
  return {
    y: g.yIdx[i] >= 0 ? g.yIdx[i] : null,
    wSum: g.wSum[i],
    M: g.M[i],
    W: g.W[i],
    pHat: g.pHat[i],
  };
}

export function gridSet(g, x, y, r) {
  const i = y * g.width + x;
  g.yIdx[i] = (r.y == null) ? -1 : (typeof r.y === 'number' ? r.y : (r.y.lightIdx | 0));
  g.wSum[i] = r.wSum;
  g.M[i] = r.M;
  g.W[i] = r.W;
  g.pHat[i] = r.pHat;
}

// ── Internals exposed for tests ──────────────────────────────────────────
export const __internals__ = { EPS };

export default {
  createReservoir, resetReservoir,
  streamReservoir, combineReservoirs, finalizeReservoir, capReservoirM,
  createReservoirGrid, resetGrid, gridGet, gridSet,
};
