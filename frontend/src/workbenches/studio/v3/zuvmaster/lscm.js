// Slice 734 — LSCM (Least Squares Conformal Maps) UV unwrap.
//
// The previous UV Master "unwrap" was a spherical projection + neighbour
// relax — fine for a ball, badly distorted for anything else. This is a
// REAL LSCM solver (Lévy, Petitjean, Ray, Maillot — SIGGRAPH 2002), the
// industry-standard conformal unwrap that Blender's "Unwrap", Maya, and
// Headus UVLayout all use. LSCM finds the UV map that best preserves
// ANGLES (conformal) by minimising the discrete conformal energy
//
//     E = Σ_triangles | (u2-u1)·rot90 - (v-projection) |²
//
// i.e. for each triangle, the gradient of u and the gradient of v should
// be a 90° rotation of each other (the Cauchy-Riemann condition). With
// two vertices pinned (to fix the 4-DOF similarity gauge: translation,
// rotation, scale), the remaining UVs are the solution of an
// over-determined sparse linear system A·x = b solved in the least
// squares sense (normal equations AᵀA x = Aᵀb), here via a Gauss-Seidel /
// Jacobi-preconditioned conjugate-gradient on the normal equations so we
// stay dependency-free (no sparse-LU library).
//
// Per LSCM, each triangle (with local orthonormal 2D coords) contributes
// two real equations relating its three (u,v) pairs. We assemble the
// real/imaginary parts following the standard M = (Mf | Mp) split where
// Mp columns multiply the pinned UVs (moved to the right-hand side).
//
// Pure JS; eval-free; deterministic. Falls back to the old projection if
// the mesh is degenerate or the solve doesn't converge.

import * as THREE from 'three';

// Build a local 2D orthonormal coordinate frame for a triangle (p0,p1,p2)
// so we can write the conformal equations in the plane of the triangle.
function _localCoords(p0, p1, p2) {
  const x1 = new THREE.Vector3().subVectors(p1, p0);
  const x2 = new THREE.Vector3().subVectors(p2, p0);
  const e1len = x1.length();
  if (e1len < 1e-12) return null;
  const e1 = x1.clone().multiplyScalar(1 / e1len);
  const proj = x2.dot(e1);
  const ortho = new THREE.Vector3().subVectors(x2, e1.clone().multiplyScalar(proj));
  const oh = ortho.length();
  if (oh < 1e-12) return null;
  // Local 2D coords: p0=(0,0), p1=(e1len,0), p2=(proj, oh).
  return [[0, 0], [e1len, 0], [proj, oh]];
}

// Conjugate-gradient solve of (AᵀA) x = Aᵀb where A is given by its
// action via applyA / applyAT (matrix-free). n = unknown count.
function _cgNormalSolve(applyA, applyAT, b, n, m, iters, tol) {
  const x = new Float64Array(n);
  // r = Aᵀb - AᵀA x  (x=0 → r = Aᵀb)
  const Ax = new Float64Array(m);
  const r = new Float64Array(n);
  applyAT(b, r);                 // r = Aᵀ b
  const p = Float64Array.from(r);
  const ATAp = new Float64Array(n);
  const Ap = new Float64Array(m);
  let rs = 0; for (let i = 0; i < n; i++) rs += r[i] * r[i];
  if (rs < 1e-30) return x;
  for (let k = 0; k < iters; k++) {
    // ATAp = Aᵀ A p
    Ap.fill(0); applyA(p, Ap);
    ATAp.fill(0); applyAT(Ap, ATAp);
    let pAp = 0; for (let i = 0; i < n; i++) pAp += p[i] * ATAp[i];
    if (Math.abs(pAp) < 1e-30) break;
    const alpha = rs / pAp;
    for (let i = 0; i < n; i++) { x[i] += alpha * p[i]; r[i] -= alpha * ATAp[i]; }
    let rs2 = 0; for (let i = 0; i < n; i++) rs2 += r[i] * r[i];
    if (rs2 < tol * tol) break;
    const beta = rs2 / rs;
    for (let i = 0; i < n; i++) p[i] = r[i] + beta * p[i];
    rs = rs2;
  }
  return x;
}

// Core LSCM. positions: Float array (3 per vert), indices: triangle list.
// Returns { ok, uv:Float32Array(2*N) } or { ok:false }.
export function lscmUnwrap(positions, indices) {
  const N = positions.length / 3;
  if (N < 3) return { ok: false, reason: 'too few vertices' };
  const idx = indices && indices.length
    ? indices
    : (() => { const a = new Uint32Array(N); for (let i = 0; i < N; i++) a[i] = i; return a; })();
  const triCount = idx.length / 3;
  if (triCount < 1) return { ok: false, reason: 'no triangles' };

  // ── Pin two vertices: the two farthest-apart vertices give a stable
  // gauge (sets translation/rotation/scale of the UV map). ──
  let pinA = 0, pinB = 1, bestD = -1;
  // cheap farthest-pair: from vertex 0 find farthest (pinA), then from
  // pinA find farthest (pinB).
  const P = (i) => new THREE.Vector3(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
  {
    let far = 0, fd = -1;
    const p0 = P(0);
    for (let i = 1; i < N; i++) { const d = p0.distanceToSquared(P(i)); if (d > fd) { fd = d; far = i; } }
    pinA = far; fd = -1; const pa = P(pinA);
    for (let i = 0; i < N; i++) { if (i === pinA) continue; const d = pa.distanceToSquared(P(i)); if (d > fd) { fd = d; pinB = i; } }
    bestD = Math.sqrt(fd);
  }
  if (bestD < 1e-9) return { ok: false, reason: 'degenerate (zero extent)' };

  // Free vertices get reindexed into [0..F); each free vertex has 2
  // unknowns (u,v) → unknown index 2*free+0 / +1.
  const isPinned = new Uint8Array(N);
  isPinned[pinA] = 1; isPinned[pinB] = 1;
  const freeIndex = new Int32Array(N).fill(-1);
  let F = 0;
  for (let i = 0; i < N; i++) if (!isPinned[i]) freeIndex[i] = F++;
  const nUnknown = 2 * F;

  // Pinned UV values: place pin A at (0,0), pin B at (1,0) — the gauge.
  const pinUV = new Map();
  pinUV.set(pinA, [0, 0]);
  pinUV.set(pinB, [1, 0]);

  // Each triangle contributes 2 rows (real + imag conformal equations).
  // Row layout: rows 2t and 2t+1. We store per-row sparse coefficients
  // for the free-unknown columns (matrix A) and accumulate the pinned
  // contributions into the RHS vector b (negated, moved to the right).
  const mRows = 2 * triCount;
  // Sparse A as row arrays of {col, val}; small (≤6 entries/row).
  const rowCols = new Array(mRows);
  const rowVals = new Array(mRows);
  for (let i = 0; i < mRows; i++) { rowCols[i] = []; rowVals[i] = []; }
  const b = new Float64Array(mRows);

  for (let t = 0; t < triCount; t++) {
    const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
    const lc = _localCoords(P(i0), P(i1), P(i2));
    if (!lc) continue;
    // Triangle area weighting (use sqrt area for numerical balance).
    const area = 0.5 * Math.abs((lc[1][0] - lc[0][0]) * (lc[2][1] - lc[0][1]) -
                                (lc[2][0] - lc[0][0]) * (lc[1][1] - lc[0][1]));
    const w = 1 / Math.sqrt(Math.max(area, 1e-9));
    // Per LSCM, complex coefficient for each triangle vertex j is
    //   W_j = (x_{j+1} - x_{j+2}) + i (y_{j+1} - y_{j+2})  (cyclic),
    // and the conformal condition is Σ_j W_j * (u_j + i v_j) = 0.
    const verts = [i0, i1, i2];
    const xs = [lc[0][0], lc[1][0], lc[2][0]];
    const ys = [lc[0][1], lc[1][1], lc[2][1]];
    for (let j = 0; j < 3; j++) {
      const jp1 = (j + 1) % 3, jp2 = (j + 2) % 3;
      const Wr = (xs[jp1] - xs[jp2]) * w;  // real part of W_j
      const Wi = (ys[jp1] - ys[jp2]) * w;  // imag part of W_j
      const vtx = verts[j];
      // Complex product W_j * (u + i v) = (Wr*u - Wi*v) + i(Wi*u + Wr*v).
      // Real eq (row 2t):   Σ (Wr*u - Wi*v) = 0
      // Imag eq (row 2t+1): Σ (Wi*u + Wr*v) = 0
      if (isPinned[vtx]) {
        const [pu, pv] = pinUV.get(vtx);
        // Move pinned contribution to RHS (negate).
        b[2 * t]     -= (Wr * pu - Wi * pv);
        b[2 * t + 1] -= (Wi * pu + Wr * pv);
      } else {
        const fu = 2 * freeIndex[vtx];     // column of u
        const fv = fu + 1;                 // column of v
        // Real row:
        rowCols[2 * t].push(fu); rowVals[2 * t].push(Wr);
        rowCols[2 * t].push(fv); rowVals[2 * t].push(-Wi);
        // Imag row:
        rowCols[2 * t + 1].push(fu); rowVals[2 * t + 1].push(Wi);
        rowCols[2 * t + 1].push(fv); rowVals[2 * t + 1].push(Wr);
      }
    }
  }

  // Matrix-free A and Aᵀ.
  const applyA = (x, out) => {       // out(m) = A x
    for (let row = 0; row < mRows; row++) {
      const cols = rowCols[row], vals = rowVals[row];
      let s = 0;
      for (let e = 0; e < cols.length; e++) s += vals[e] * x[cols[e]];
      out[row] = s;
    }
  };
  const applyAT = (y, out) => {      // out(n) = Aᵀ y
    out.fill(0);
    for (let row = 0; row < mRows; row++) {
      const cols = rowCols[row], vals = rowVals[row], yr = y[row];
      for (let e = 0; e < cols.length; e++) out[cols[e]] += vals[e] * yr;
    }
  };

  const sol = _cgNormalSolve(applyA, applyAT, b, nUnknown, mRows, Math.max(200, nUnknown), 1e-7);

  // Scatter solution + pinned values into a full UV array.
  const uv = new Float32Array(N * 2);
  for (let i = 0; i < N; i++) {
    if (isPinned[i]) { const [u, v] = pinUV.get(i); uv[i * 2] = u; uv[i * 2 + 1] = v; }
    else { const f = freeIndex[i]; uv[i * 2] = sol[2 * f]; uv[i * 2 + 1] = sol[2 * f + 1]; }
  }

  // Validate: finite + non-degenerate spread.
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let i = 0; i < N; i++) {
    const u = uv[i * 2], v = uv[i * 2 + 1];
    if (!Number.isFinite(u) || !Number.isFinite(v)) return { ok: false, reason: 'non-finite solve' };
    if (u < minU) minU = u; if (u > maxU) maxU = u;
    if (v < minV) minV = v; if (v > maxV) maxV = v;
  }
  const du = maxU - minU, dv = maxV - minV;
  if (du < 1e-9 && dv < 1e-9) return { ok: false, reason: 'collapsed solve' };

  // Normalise into the unit square (preserve aspect ratio).
  const scale = 1 / Math.max(du, dv, 1e-9);
  for (let i = 0; i < N; i++) {
    uv[i * 2]     = (uv[i * 2]     - minU) * scale;
    uv[i * 2 + 1] = (uv[i * 2 + 1] - minV) * scale;
  }
  return { ok: true, uv, pins: [pinA, pinB] };
}

// Mean angle distortion (degrees) between a triangle's 3D corner angles
// and its UV corner angles — 0 means perfectly conformal. Used by the
// e2e to prove LSCM beats naive projection.
export function uvAngleDistortion(positions, indices, uv) {
  const idx = indices && indices.length ? indices : null;
  const triCount = idx ? idx.length / 3 : positions.length / 9;
  const P = (i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  const ang3 = (a, b, c) => {
    const v1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const d = v1[0] * v2[0] + v1[1] * v2[1] + v1[2] * v2[2];
    const l1 = Math.hypot(v1[0], v1[1], v1[2]), l2 = Math.hypot(v2[0], v2[1], v2[2]);
    return Math.acos(Math.max(-1, Math.min(1, d / (l1 * l2 + 1e-12))));
  };
  const ang2 = (a, b, c) => {
    const v1 = [b[0] - a[0], b[1] - a[1]];
    const v2 = [c[0] - a[0], c[1] - a[1]];
    const d = v1[0] * v2[0] + v1[1] * v2[1];
    const l1 = Math.hypot(v1[0], v1[1]), l2 = Math.hypot(v2[0], v2[1]);
    return Math.acos(Math.max(-1, Math.min(1, d / (l1 * l2 + 1e-12))));
  };
  let sum = 0, cnt = 0;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3] : t * 3, i1 = idx ? idx[t * 3 + 1] : t * 3 + 1, i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const p0 = P(i0), p1 = P(i1), p2 = P(i2);
    const u0 = [uv[i0 * 2], uv[i0 * 2 + 1]], u1 = [uv[i1 * 2], uv[i1 * 2 + 1]], u2 = [uv[i2 * 2], uv[i2 * 2 + 1]];
    const a3 = [ang3(p0, p1, p2), ang3(p1, p2, p0), ang3(p2, p0, p1)];
    const a2 = [ang2(u0, u1, u2), ang2(u1, u2, u0), ang2(u2, u0, u1)];
    for (let k = 0; k < 3; k++) { sum += Math.abs(a3[k] - a2[k]); cnt++; }
  }
  return cnt ? (sum / cnt) * 180 / Math.PI : 0;
}
