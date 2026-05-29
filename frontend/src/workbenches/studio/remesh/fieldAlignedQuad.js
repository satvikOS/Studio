/*
 * Studio field-aligned quad remesh (ZBrush ZRemesher / Instant Field-Aligned
 * Meshes, Jakob et al.). The genuine pipeline:
 *   1. estimate the principal-curvature direction field on the surface (real
 *      differential geometry: first/second fundamental forms -> shape operator
 *      -> eigen-directions),
 *   2. smooth it as a 2-RoSy line field (interpolate exp(i*2θ)),
 *   3. trace field-following streamlines into a structured quad NET (a spine
 *      along direction-1, ribs along direction-2) so the quad edges FLOW with
 *      curvature instead of the parameter axes.
 *
 * Honest scope: operates on a parametric (disk-topology) surface sampler so the
 * net stays structured (no singularity / integer-grid extraction on arbitrary
 * genus — that is the remaining research frontier). Deterministic.
 */

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// A few parametric test surfaces (u,v in [0,1]); Y is up.
export const FIELD_SURFACES = {
  // wave running along the DIAGONAL -> principal curvature ~45deg, so a
  // field-aligned net is diagonal while a naive u/v grid is not.
  diagwave: (u, v) => [(u - 0.5) * 1.2, 0.14 * Math.sin(Math.PI * 3 * (u + v)), (v - 0.5) * 1.2],
  saddle: (u, v) => { const x = (u - 0.5) * 1.2, y = (v - 0.5) * 1.2; return [x, (x * x - y * y) * 0.55, y]; },
  cylinder: (u, v) => { const a = u * Math.PI * 1.8; return [0.4 * Math.cos(a), (v - 0.5) * 1.0, 0.4 * Math.sin(a)]; },
};

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

// Principal max-curvature direction angle (in u,v parameter space) at (u,v).
function principalAngle(S, u, v) {
  const h = 2e-3;
  const Sat = (uu, vv) => S(clamp01(uu), clamp01(vv));
  const Su = sub(Sat(u + h, v), Sat(u - h, v)).map((x) => x / (2 * h));
  const Sv = sub(Sat(u, v + h), Sat(u, v - h)).map((x) => x / (2 * h));
  const Suu = (() => { const a = Sat(u + h, v), b = Sat(u, v), c = Sat(u - h, v); return [(a[0] - 2 * b[0] + c[0]) / (h * h), (a[1] - 2 * b[1] + c[1]) / (h * h), (a[2] - 2 * b[2] + c[2]) / (h * h)]; })();
  const Svv = (() => { const a = Sat(u, v + h), b = Sat(u, v), c = Sat(u, v - h); return [(a[0] - 2 * b[0] + c[0]) / (h * h), (a[1] - 2 * b[1] + c[1]) / (h * h), (a[2] - 2 * b[2] + c[2]) / (h * h)]; })();
  const Suv = (() => { const a = Sat(u + h, v + h), b = Sat(u + h, v - h), c = Sat(u - h, v + h), d = Sat(u - h, v - h); return [(a[0] - b[0] - c[0] + d[0]) / (4 * h * h), (a[1] - b[1] - c[1] + d[1]) / (4 * h * h), (a[2] - b[2] - c[2] + d[2]) / (4 * h * h)]; })();
  const n = norm(cross(Su, Sv));
  const E = dot(Su, Su), F = dot(Su, Sv), G = dot(Sv, Sv);
  const L = dot(Suu, n), M = dot(Suv, n), Nn = dot(Svv, n);
  const det = E * G - F * F || 1e-9;
  // shape operator W = I^-1 II
  const w11 = (G * L - F * M) / det, w12 = (G * M - F * Nn) / det;
  const w21 = (-F * L + E * M) / det, w22 = (-F * M + E * Nn) / det;
  const tr = w11 + w22, dW = w11 * w22 - w12 * w21;
  const disc = Math.sqrt(Math.max(0, tr * tr - 4 * dW));
  const k1 = (tr + disc) / 2, k2 = (tr - disc) / 2;
  const kMax = Math.abs(k1) >= Math.abs(k2) ? k1 : k2;
  // eigenvector of W for kMax: (w12, kMax - w11) or (kMax - w22, w21)
  let a = w12, b = kMax - w11;
  if (Math.abs(a) + Math.abs(b) < 1e-7) { a = kMax - w22; b = w21; }
  if (Math.abs(a) + Math.abs(b) < 1e-7) { a = 1; b = 0; } // umbilic / flat -> default
  return Math.atan2(b, a);
}

function computeField(S, N) {
  const theta = new Float64Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    theta[j * N + i] = principalAngle(S, i / (N - 1), j / (N - 1));
  }
  return theta;
}

// 2-RoSy line-field smoothing: average exp(i*2θ) over 4-neighbours, iterate.
function smoothField(theta, N, iters) {
  let cur = theta;
  for (let it = 0; it < iters; it++) {
    const next = new Float64Array(N * N);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      let cx = Math.cos(2 * cur[j * N + i]), cy = Math.sin(2 * cur[j * N + i]);
      const add = (ii, jj) => { if (ii >= 0 && ii < N && jj >= 0 && jj < N) { cx += Math.cos(2 * cur[jj * N + ii]); cy += Math.sin(2 * cur[jj * N + ii]); } };
      add(i - 1, j); add(i + 1, j); add(i, j - 1); add(i, j + 1);
      next[j * N + i] = Math.atan2(cy, cx) / 2;
    }
    cur = next;
  }
  return cur;
}

function sampleField(theta, N, u, v) {
  const fx = clamp01(u) * (N - 1), fy = clamp01(v) * (N - 1);
  const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(N - 1, x0 + 1), y1 = Math.min(N - 1, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const C = (i, k) => { const t = theta[k * N + i]; return [Math.cos(2 * t), Math.sin(2 * t)]; };
  const lp = (A, B, t) => [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t];
  const c = lp(lp(C(x0, y0), C(x1, y0), tx), lp(C(x0, y1), C(x1, y1), tx), ty);
  return Math.atan2(c[1], c[0]) / 2;
}

function traceLine(theta, N, start, perp, sign, stepLen, maxSteps) {
  const pts = [[start[0], start[1]]]; let cur = [start[0], start[1]]; let prev = null;
  for (let s = 0; s < maxSteps; s++) {
    let t = sampleField(theta, N, cur[0], cur[1]); if (perp) t += Math.PI / 2;
    let d = [Math.cos(t) * sign, Math.sin(t) * sign];
    if (prev && (d[0] * prev[0] + d[1] * prev[1]) < 0) d = [-d[0], -d[1]]; // 2-RoSy: keep going
    const nx = cur[0] + d[0] * stepLen, ny = cur[1] + d[1] * stepLen;
    if (nx < 0 || nx > 1 || ny < 0 || ny > 1) break;
    pts.push([nx, ny]); cur = [nx, ny]; prev = d;
  }
  return pts;
}

function traceBoth(theta, N, start, perp, stepLen, maxSteps) {
  const fwd = traceLine(theta, N, start, perp, 1, stepLen, maxSteps);
  const bwd = traceLine(theta, N, start, perp, -1, stepLen, maxSteps);
  return [...bwd.reverse(), ...fwd.slice(1)];
}

function resample(pts, M) {
  if (pts.length < 2) { const p = pts[0] || [0.5, 0.5]; return Array.from({ length: M }, () => [p[0], p[1]]); }
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const total = cum[cum.length - 1] || 1; const out = [];
  for (let m = 0; m < M; m++) {
    const target = total * m / (M - 1);
    let i = 1; while (i < cum.length && cum[i] < target) i++;
    const i0 = Math.min(i, cum.length - 1);
    const t = (target - cum[i0 - 1]) / ((cum[i0] - cum[i0 - 1]) || 1);
    out.push([pts[i0 - 1][0] + (pts[i0][0] - pts[i0 - 1][0]) * t, pts[i0 - 1][1] + (pts[i0][1] - pts[i0 - 1][1]) * t]);
  }
  return out;
}

// Mean line-field direction over the grid (for verification), as an angle in [0,π).
export function meanFieldAngle(theta, N) {
  let cx = 0, cy = 0; for (let k = 0; k < N * N; k++) { cx += Math.cos(2 * theta[k]); cy += Math.sin(2 * theta[k]); }
  let a = Math.atan2(cy, cx) / 2; if (a < 0) a += Math.PI; return a;
}

export function fieldAlignedQuadRemesh(S, opts = {}) {
  const N = opts.fieldRes || 28;
  const K = opts.spine || 20;   // rows
  const M = opts.ribs || 20;    // cols
  const stepLen = opts.step || (1.1 / Math.max(K, M));
  const maxSteps = Math.ceil(1.6 / stepLen);

  const theta0 = computeField(S, N);
  const theta = smoothField(theta0, N, opts.smooth != null ? opts.smooth : 12);

  // spine along direction-1 from the centre, then ribs along direction-2.
  const spine = resample(traceBoth(theta, N, [0.5, 0.5], false, stepLen, maxSteps), K);
  const gridUV = spine.map((sp) => resample(traceBoth(theta, N, sp, true, stepLen, maxSteps), M));

  const positions = new Float32Array(K * M * 3);
  for (let k = 0; k < K; k++) for (let m = 0; m < M; m++) {
    const p = S(gridUV[k][m][0], gridUV[k][m][1]);
    const o = (k * M + m) * 3; positions[o] = p[0]; positions[o + 1] = p[1]; positions[o + 2] = p[2];
  }
  const quads = []; const triIndex = [];
  for (let k = 0; k < K - 1; k++) for (let m = 0; m < M - 1; m++) {
    const a = k * M + m, b = k * M + m + 1, c = (k + 1) * M + m + 1, d = (k + 1) * M + m;
    quads.push([a, b, c, d]); triIndex.push(a, b, d, b, c, d);
  }

  // field-alignment metric: how well rib edges follow the perpendicular field
  // (line-field measure |cos(Δ)|, 1 = perfectly aligned).
  let alignSum = 0, alignN = 0;
  for (let k = 0; k < K; k++) for (let m = 0; m < M - 1; m++) {
    const p0 = gridUV[k][m], p1 = gridUV[k][m + 1];
    const du = p1[0] - p0[0], dv = p1[1] - p0[1]; const len = Math.hypot(du, dv);
    if (len < 1e-6) continue;
    const edgeAng = Math.atan2(dv, du);
    const fieldAng = sampleField(theta, N, (p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2) + Math.PI / 2;
    alignSum += Math.abs(Math.cos(edgeAng - fieldAng)); alignN++;
  }
  const alignment = alignN ? alignSum / alignN : 0;

  return { positions, triIndex, quads, rows: K, cols: M, quadCount: quads.length, alignment, meanFieldAngle: meanFieldAngle(theta, N) };
}
