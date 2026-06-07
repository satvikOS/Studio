// ArchDisc Studio V3 — co-rotated linear-elastic FEM soft-body solver
// (slice 783, Houdini Vellum-tier).
//
// Each tetrahedron is treated as a constant-strain linear-elastic
// element with a co-rotational extraction so the stress is computed
// in the un-rotated frame and the resulting force is rotated back to
// world space. This is the standard formulation used by Vellum, PhysX
// FEM, and the Müller / Gross / Teschner papers (~2004-2005) — it
// gives volumetric stiffness without the artefacts that pure linear
// elasticity exhibits under rotation.
//
// Per tet (4 nodes A,B,C,D):
//
//   • REST: at attach time the rest edge matrix
//
//       Dm = [ B-A | C-A | D-A ]   (3×3)
//
//     is built and inverted. `restInv = Dm^{-1}` is cached on the tet
//     along with its rest volume V0 = det(Dm)/6.
//
//   • STEP: at each substep the current edge matrix
//
//       Ds = [ b-a | c-a | d-a ]
//
//     and the deformation gradient F = Ds · restInv are computed.
//
//   • POLAR: F = R · S where R is the rotation part. We extract R by
//     iterating Higham's "average-with-its-inverse-transpose" until
//     convergence (4 iterations is more than enough for a damped sim
//     even on heavily-deformed tets; degenerate tets fall back to R = I).
//
//   • STRAIN: Linear (small-strain) Cauchy strain in the un-rotated
//     frame: eps = ½(R^T F + F^T R) − I = ½(S + S^T) − I.
//
//   • STRESS: Hooke isotropic stress:
//
//       sigma = 2·mu·eps + lambda·trace(eps)·I
//
//     with Lamé parameters (mu, lambda) derived from Young's modulus E
//     and Poisson's ratio nu the standard way.
//
//   • FORCE: f_i = -V0 · R · sigma · restInv^T · faceNormal_i where
//     the per-node faceNormal_i is the rest-face area-weighted normal
//     of the face opposite node i. For a constant-strain tet this
//     reduces to f_i = -V0 · R · sigma · grad_i where the four
//     gradients grad_i are the columns of restInv (and grad_A = the
//     negative sum of the other three). This is the form we use.
//
// Integrator: Verlet (positions only, no separate velocity buffer).
// This matches the slice-765 cloth solver and the slice-757 / slice-767
// soft-body family, so attach/step semantics are uniform across the
// Studio sim suite. Verlet is a symplectic integrator → energy stable
// even at coarse dts. Gravity is the only external body force.
//
// Pinning: pin a node by setting its inverse mass to 0. The integrator
// reads invMass directly; pinned nodes are pure constraints.

import * as THREE from 'three';
import { signedTetVolume } from './tetrahedralize.js';

// ─── Build ──────────────────────────────────────────────────────────

/**
 * Build a FEM soft-body state from a `{nodes, tets}` tetrahedral mesh
 * (as returned by `tetrahedralize()`).
 *
 * @param {Object} mesh      — from tetrahedralize()
 * @param {Object} opts
 *   @param {number} [opts.youngsModulus=5e4] — E in Pa-ish units;
 *     larger → stiffer. The default works for unit-cube-scale meshes
 *     with dt ≈ 1/120; see e2e for tuning.
 *   @param {number} [opts.poissonRatio=0.3] — nu in [-1, 0.5).
 *   @param {number} [opts.density=1000] — mass per unit volume; node
 *     mass is summed from the surrounding tets.
 *   @param {number} [opts.damping=0.99] — Verlet velocity damping per
 *     STEP (not per substep). 1.0 → no damping.
 *   @param {Array<number>} [opts.gravity=[0,-9.81,0]] — body force.
 *   @param {Array<number>} [opts.pinIndices] — node indices to pin at
 *     build time (mass → ∞ → invMass = 0).
 *
 * @returns {Object|null} femState — opaque; pass to `stepFEM`.
 */
export function buildFEM(mesh, opts) {
  if (!mesh || !mesh.nodes || !mesh.tets || mesh.tets.length === 0) return null;
  const o = opts || {};
  const E = Number.isFinite(+o.youngsModulus) ? +o.youngsModulus : 5e4;
  const nu = Number.isFinite(+o.poissonRatio) ? +o.poissonRatio : 0.3;
  const density = Number.isFinite(+o.density) ? +o.density : 1000;
  const damping = Number.isFinite(+o.damping) ? +o.damping : 0.99;
  const g = Array.isArray(o.gravity) && o.gravity.length === 3
    ? [+o.gravity[0] || 0, +o.gravity[1] || 0, +o.gravity[2] || 0]
    : [0, -9.81, 0];

  // Lamé parameters (isotropic).
  const mu = E / (2 * (1 + nu));
  const lambda = (E * nu) / ((1 + nu) * (1 - 2 * nu));

  const nodeCount = mesh.nodeCount;
  const tetCount = mesh.tetCount;

  // ── Node state ────────────────────────────────────────────────────
  const positions     = new Float32Array(mesh.nodes); // current
  const prevPositions = new Float32Array(mesh.nodes); // last step
  const restPositions = new Float32Array(mesh.nodes); // never mutated
  const masses    = new Float32Array(nodeCount);
  const invMasses = new Float32Array(nodeCount);

  // ── Per-tet rest data ─────────────────────────────────────────────
  // restInvFlat: 9 floats per tet (row-major 3x3 = restInv).
  // restVols:    1 float per tet (rest volume V0 = det(Dm)/6).
  // tetGrads:    12 floats per tet (4 gradient vectors, one per node).
  //   Used during force assembly: f_i = -V0 · R · sigma · grad_i.
  const restInvFlat = new Float32Array(tetCount * 9);
  const restVols    = new Float32Array(tetCount);
  const tetGrads    = new Float32Array(tetCount * 12);

  let kept = 0;
  const tetsArr = mesh.tets;
  for (let t = 0; t < tetCount; t++) {
    const a = tetsArr[t * 4], b = tetsArr[t * 4 + 1];
    const c = tetsArr[t * 4 + 2], d = tetsArr[t * 4 + 3];
    const ax = restPositions[a * 3], ay = restPositions[a * 3 + 1], az = restPositions[a * 3 + 2];
    const bx = restPositions[b * 3], by = restPositions[b * 3 + 1], bz = restPositions[b * 3 + 2];
    const cx = restPositions[c * 3], cy = restPositions[c * 3 + 1], cz = restPositions[c * 3 + 2];
    const dx = restPositions[d * 3], dy = restPositions[d * 3 + 1], dz = restPositions[d * 3 + 2];
    // Dm columns: B-A, C-A, D-A
    const m00 = bx - ax, m10 = by - ay, m20 = bz - az;
    const m01 = cx - ax, m11 = cy - ay, m21 = cz - az;
    const m02 = dx - ax, m12 = dy - ay, m22 = dz - az;
    const det = m00 * (m11 * m22 - m12 * m21)
              - m01 * (m10 * m22 - m12 * m20)
              + m02 * (m10 * m21 - m11 * m20);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
      // Degenerate rest tet — skip (no contribution to forces).
      restVols[t] = 0;
      continue;
    }
    const invDet = 1 / det;
    // restInv = inverse(Dm), row-major
    const i00 =  (m11 * m22 - m12 * m21) * invDet;
    const i01 = -(m01 * m22 - m02 * m21) * invDet;
    const i02 =  (m01 * m12 - m02 * m11) * invDet;
    const i10 = -(m10 * m22 - m12 * m20) * invDet;
    const i11 =  (m00 * m22 - m02 * m20) * invDet;
    const i12 = -(m00 * m12 - m02 * m10) * invDet;
    const i20 =  (m10 * m21 - m11 * m20) * invDet;
    const i21 = -(m00 * m21 - m01 * m20) * invDet;
    const i22 =  (m00 * m11 - m01 * m10) * invDet;
    restInvFlat[t * 9]     = i00; restInvFlat[t * 9 + 1] = i01; restInvFlat[t * 9 + 2] = i02;
    restInvFlat[t * 9 + 3] = i10; restInvFlat[t * 9 + 4] = i11; restInvFlat[t * 9 + 5] = i12;
    restInvFlat[t * 9 + 6] = i20; restInvFlat[t * 9 + 7] = i21; restInvFlat[t * 9 + 8] = i22;
    const V0 = det / 6; // can be negative if Dm is left-handed
    const V0abs = Math.abs(V0);
    restVols[t] = V0abs;

    // Gradients of shape functions in rest frame:
    //   grad_B = restInv row 0
    //   grad_C = restInv row 1
    //   grad_D = restInv row 2
    //   grad_A = -(grad_B + grad_C + grad_D)
    // (rows because we're using the transpose convention so the force
    // equation works out cleanly below).
    const gBx = i00, gBy = i01, gBz = i02;
    const gCx = i10, gCy = i11, gCz = i12;
    const gDx = i20, gDy = i21, gDz = i22;
    const gAx = -(gBx + gCx + gDx);
    const gAy = -(gBy + gCy + gDy);
    const gAz = -(gBz + gCz + gDz);
    tetGrads[t * 12]      = gAx; tetGrads[t * 12 + 1]  = gAy; tetGrads[t * 12 + 2]  = gAz;
    tetGrads[t * 12 + 3]  = gBx; tetGrads[t * 12 + 4]  = gBy; tetGrads[t * 12 + 5]  = gBz;
    tetGrads[t * 12 + 6]  = gCx; tetGrads[t * 12 + 7]  = gCy; tetGrads[t * 12 + 8]  = gCz;
    tetGrads[t * 12 + 9]  = gDx; tetGrads[t * 12 + 10] = gDy; tetGrads[t * 12 + 11] = gDz;

    // Mass lumping: each tet contributes density·V0/4 to each of its
    // four nodes. This is the "lumped mass" approximation used by
    // every real-time FEM solver because the consistent mass matrix
    // would require sparse linear solves we explicitly don't want.
    const m = (density * V0abs) / 4;
    masses[a] += m;
    masses[b] += m;
    masses[c] += m;
    masses[d] += m;
    kept++;
  }
  if (kept === 0) return null;

  // Inverse mass (pin support below will override).
  for (let i = 0; i < nodeCount; i++) {
    invMasses[i] = masses[i] > 0 ? (1 / masses[i]) : 0;
  }
  // Pin requested nodes.
  if (Array.isArray(o.pinIndices)) {
    for (const idx of o.pinIndices) {
      const i = idx | 0;
      if (i >= 0 && i < nodeCount) {
        invMasses[i] = 0;
      }
    }
  }

  return {
    nodeCount,
    tetCount,
    positions,
    prevPositions,
    restPositions,
    masses,
    invMasses,
    tetsArr,
    restInvFlat,
    restVols,
    tetGrads,
    mu,
    lambda,
    damping,
    gravity: g,
    youngsModulus: E,
    poissonRatio: nu,
    density,
  };
}

// ─── Step ────────────────────────────────────────────────────────────

/**
 * Advance the FEM state by `dt` seconds.
 *
 * The integration is a single Verlet step (no PBD outer iterations —
 * stiffness comes from the elasticity directly):
 *
 *   1) Compute per-tet F, polar-decompose to (R, S).
 *   2) Compute strain eps = ½(S + S^T) − I (small-strain in un-rotated
 *      frame).
 *   3) Stress sigma = 2·mu·eps + lambda·trace(eps)·I.
 *   4) For each tet node i, accumulate force f_i = -V0 · R · sigma · grad_i.
 *   5) Verlet integrate every node: a = f * invMass + gravity, then
 *        x_new = x + (x - x_prev) * damping + a * dt^2.
 *   6) Pinned nodes (invMass = 0) skip integration.
 *
 * @returns {Object} { ok:true, energyResidual:number } where
 *   energyResidual is the average ||S − I||² across all tets — a
 *   useful liveness signal (drops to ~0 when the body is at rest).
 */
export function stepFEM(state, dt) {
  if (!state || state.tetCount === 0) return { ok: false, energyResidual: 0 };
  const stepDt = Number.isFinite(+dt) && +dt > 0 ? +dt : (1 / 120);
  const dt2 = stepDt * stepDt;
  const {
    nodeCount, tetCount, positions, prevPositions,
    invMasses, tetsArr, restInvFlat, restVols, tetGrads,
    mu, lambda, damping, gravity,
  } = state;

  // ── Forces ──────────────────────────────────────────────────────
  // Accumulate into a per-step force buffer. Reuse across calls via
  // a stashed Float32Array to avoid GC churn at high tet counts.
  let forces = state._forces;
  if (!forces || forces.length !== nodeCount * 3) {
    forces = new Float32Array(nodeCount * 3);
    state._forces = forces;
  } else {
    forces.fill(0);
  }

  let strainAccum = 0;
  for (let t = 0; t < tetCount; t++) {
    const V0 = restVols[t];
    if (V0 === 0) continue;
    const a = tetsArr[t * 4], b = tetsArr[t * 4 + 1];
    const c = tetsArr[t * 4 + 2], d = tetsArr[t * 4 + 3];

    // Current edge matrix Ds = [b-a | c-a | d-a]
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const dx = positions[d * 3], dy = positions[d * 3 + 1], dz = positions[d * 3 + 2];
    const s00 = bx - ax, s10 = by - ay, s20 = bz - az;
    const s01 = cx - ax, s11 = cy - ay, s21 = cz - az;
    const s02 = dx - ax, s12 = dy - ay, s22 = dz - az;

    // F = Ds · restInv  (3x3)
    const i00 = restInvFlat[t * 9],     i01 = restInvFlat[t * 9 + 1], i02 = restInvFlat[t * 9 + 2];
    const i10 = restInvFlat[t * 9 + 3], i11 = restInvFlat[t * 9 + 4], i12 = restInvFlat[t * 9 + 5];
    const i20 = restInvFlat[t * 9 + 6], i21 = restInvFlat[t * 9 + 7], i22 = restInvFlat[t * 9 + 8];

    const F00 = s00 * i00 + s01 * i10 + s02 * i20;
    const F01 = s00 * i01 + s01 * i11 + s02 * i21;
    const F02 = s00 * i02 + s01 * i12 + s02 * i22;
    const F10 = s10 * i00 + s11 * i10 + s12 * i20;
    const F11 = s10 * i01 + s11 * i11 + s12 * i21;
    const F12 = s10 * i02 + s11 * i12 + s12 * i22;
    const F20 = s20 * i00 + s21 * i10 + s22 * i20;
    const F21 = s20 * i01 + s21 * i11 + s22 * i21;
    const F22 = s20 * i02 + s21 * i12 + s22 * i22;

    // Polar decomposition F = R · S  (R orthogonal, S symmetric).
    // Higham iteration: R_{k+1} = ½(R_k + R_k^{-T}); start with R = F.
    let r00 = F00, r01 = F01, r02 = F02;
    let r10 = F10, r11 = F11, r12 = F12;
    let r20 = F20, r21 = F21, r22 = F22;
    let converged = false;
    for (let iter = 0; iter < 6; iter++) {
      // inv(R)^T  =  (R^T)^{-1}  =  (R^{-1})^T
      // Compute R^{-1} via cofactors then transpose.
      const m00 = r00, m01 = r01, m02 = r02;
      const m10 = r10, m11 = r11, m12 = r12;
      const m20 = r20, m21 = r21, m22 = r22;
      const det = m00 * (m11 * m22 - m12 * m21)
                - m01 * (m10 * m22 - m12 * m20)
                + m02 * (m10 * m21 - m11 * m20);
      if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
        // Degenerate frame — fall back to identity.
        r00 = 1; r01 = 0; r02 = 0;
        r10 = 0; r11 = 1; r12 = 0;
        r20 = 0; r21 = 0; r22 = 1;
        converged = true;
        break;
      }
      const id = 1 / det;
      const c00 =  (m11 * m22 - m12 * m21) * id;
      const c01 = -(m01 * m22 - m02 * m21) * id;
      const c02 =  (m01 * m12 - m02 * m11) * id;
      const c10 = -(m10 * m22 - m12 * m20) * id;
      const c11 =  (m00 * m22 - m02 * m20) * id;
      const c12 = -(m00 * m12 - m02 * m10) * id;
      const c20 =  (m10 * m21 - m11 * m20) * id;
      const c21 = -(m00 * m21 - m01 * m20) * id;
      const c22 =  (m00 * m11 - m01 * m10) * id;
      // R_{k+1} = ½(R_k + inv(R_k)^T)
      // inv(R)^T  →  rows of inv(R) become columns
      const nr00 = 0.5 * (r00 + c00);
      const nr01 = 0.5 * (r01 + c10);
      const nr02 = 0.5 * (r02 + c20);
      const nr10 = 0.5 * (r10 + c01);
      const nr11 = 0.5 * (r11 + c11);
      const nr12 = 0.5 * (r12 + c21);
      const nr20 = 0.5 * (r20 + c02);
      const nr21 = 0.5 * (r21 + c12);
      const nr22 = 0.5 * (r22 + c22);
      const dr = Math.abs(nr00 - r00) + Math.abs(nr11 - r11) + Math.abs(nr22 - r22);
      r00 = nr00; r01 = nr01; r02 = nr02;
      r10 = nr10; r11 = nr11; r12 = nr12;
      r20 = nr20; r21 = nr21; r22 = nr22;
      if (dr < 1e-7) { converged = true; break; }
    }
    if (!converged) {
      // Tolerate; the matrix is close enough.
    }
    // S = R^T · F
    const S00 = r00 * F00 + r10 * F10 + r20 * F20;
    const S01 = r00 * F01 + r10 * F11 + r20 * F21;
    const S02 = r00 * F02 + r10 * F12 + r20 * F22;
    const S10 = r01 * F00 + r11 * F10 + r21 * F20;
    const S11 = r01 * F01 + r11 * F11 + r21 * F21;
    const S12 = r01 * F02 + r11 * F12 + r21 * F22;
    const S20 = r02 * F00 + r12 * F10 + r22 * F20;
    const S21 = r02 * F01 + r12 * F11 + r22 * F21;
    const S22 = r02 * F02 + r12 * F12 + r22 * F22;

    // Strain eps = ½(S + S^T) − I
    const e00 = S00 - 1;
    const e11 = S11 - 1;
    const e22 = S22 - 1;
    const e01 = 0.5 * (S01 + S10);
    const e02 = 0.5 * (S02 + S20);
    const e12 = 0.5 * (S12 + S21);

    // Stress sigma = 2·mu·eps + lambda·tr(eps)·I
    const trEps = e00 + e11 + e22;
    const lt = lambda * trEps;
    const sig00 = 2 * mu * e00 + lt;
    const sig11 = 2 * mu * e11 + lt;
    const sig22 = 2 * mu * e22 + lt;
    const sig01 = 2 * mu * e01;
    const sig02 = 2 * mu * e02;
    const sig12 = 2 * mu * e12;

    // For energy residual liveness — sum of squared strain entries.
    strainAccum += e00 * e00 + e11 * e11 + e22 * e22
                 + 2 * (e01 * e01 + e02 * e02 + e12 * e12);

    // Force on node i:  f_i = -V0 · R · sigma · grad_i
    // First compute  M = R · sigma   once (3x3),  then for each node
    // multiply M by grad_i (3-vec) and accumulate.
    // M_ij = sum_k R_ik · sigma_kj   (sigma is symmetric)
    const M00 = r00 * sig00 + r01 * sig01 + r02 * sig02;
    const M01 = r00 * sig01 + r01 * sig11 + r02 * sig12;
    const M02 = r00 * sig02 + r01 * sig12 + r02 * sig22;
    const M10 = r10 * sig00 + r11 * sig01 + r12 * sig02;
    const M11 = r10 * sig01 + r11 * sig11 + r12 * sig12;
    const M12 = r10 * sig02 + r11 * sig12 + r12 * sig22;
    const M20 = r20 * sig00 + r21 * sig01 + r22 * sig02;
    const M21 = r20 * sig01 + r21 * sig11 + r22 * sig12;
    const M22 = r20 * sig02 + r21 * sig12 + r22 * sig22;

    // Apply -V0 · M · grad_i to each of the four nodes.
    for (let k = 0; k < 4; k++) {
      const nodeIdx = tetsArr[t * 4 + k];
      const gx = tetGrads[t * 12 + k * 3];
      const gy = tetGrads[t * 12 + k * 3 + 1];
      const gz = tetGrads[t * 12 + k * 3 + 2];
      const fx = -V0 * (M00 * gx + M01 * gy + M02 * gz);
      const fy = -V0 * (M10 * gx + M11 * gy + M12 * gz);
      const fz = -V0 * (M20 * gx + M21 * gy + M22 * gz);
      forces[nodeIdx * 3]     += fx;
      forces[nodeIdx * 3 + 1] += fy;
      forces[nodeIdx * 3 + 2] += fz;
    }
  }

  // ── Verlet integration ──────────────────────────────────────────
  const gx = gravity[0] || 0;
  const gy = gravity[1] || 0;
  const gz = gravity[2] || 0;
  for (let i = 0; i < nodeCount; i++) {
    const w = invMasses[i];
    if (w === 0) {
      // Pinned: keep prevPositions synced so velocity stays 0.
      prevPositions[i * 3]     = positions[i * 3];
      prevPositions[i * 3 + 1] = positions[i * 3 + 1];
      prevPositions[i * 3 + 2] = positions[i * 3 + 2];
      continue;
    }
    const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2;
    const px = positions[ix], py = positions[iy], pz = positions[iz];
    const vx = (px - prevPositions[ix]) * damping;
    const vy = (py - prevPositions[iy]) * damping;
    const vz = (pz - prevPositions[iz]) * damping;
    const ax = forces[ix] * w + gx;
    const ay = forces[iy] * w + gy;
    const az = forces[iz] * w + gz;
    prevPositions[ix] = px;
    prevPositions[iy] = py;
    prevPositions[iz] = pz;
    positions[ix] = px + vx + ax * dt2;
    positions[iy] = py + vy + ay * dt2;
    positions[iz] = pz + vz + az * dt2;
  }

  return { ok: true, energyResidual: strainAccum / Math.max(1, tetCount) };
}

// ─── Mutators ──────────────────────────────────────────────────────

/** Pin a single tetrahedral node (invMass → 0). */
export function pinNode(state, vertIdx) {
  if (!state) return { ok: false, error: 'no state' };
  const i = vertIdx | 0;
  if (i < 0 || i >= state.nodeCount) return { ok: false, error: 'out of range' };
  state.invMasses[i] = 0;
  // Snap prev so the pinned node doesn't carry stale velocity.
  state.prevPositions[i * 3]     = state.positions[i * 3];
  state.prevPositions[i * 3 + 1] = state.positions[i * 3 + 1];
  state.prevPositions[i * 3 + 2] = state.positions[i * 3 + 2];
  return { ok: true };
}

/** Set the gravity body force ([x,y,z] or {x,y,z}). */
export function setGravity(state, g) {
  if (!state) return { ok: false, error: 'no state' };
  const gx = Array.isArray(g) ? +g[0] || 0 : +(g && g.x) || 0;
  const gy = Array.isArray(g) ? +g[1] || 0 : +(g && g.y) || 0;
  const gz = Array.isArray(g) ? +g[2] || 0 : +(g && g.z) || 0;
  state.gravity = [gx, gy, gz];
  return { ok: true };
}

// ─── Surface deformation ────────────────────────────────────────────

/**
 * For surface-skinning a triangle mesh to the FEM solver, the typical
 * pipeline is:
 *
 *   1) At attach time, for every surface vertex, find which tet
 *      contains it and the barycentric coords inside that tet.
 *   2) After each step, recompute the surface vertex position as a
 *      linear combination of the 4 tet nodes using those barycentric
 *      coords.
 *
 * This pair is provided here so the install path can bind a surface
 * mesh to a FEM solver and have the viewport mesh deform with the
 * volumetric body.
 *
 * `buildSurfaceBinding(surfacePositions, femState)` returns a binding
 * table; `applySurfaceBinding(binding, femState, outPositions)` runs
 * the recombination in-place.
 */
export function buildSurfaceBinding(surfacePositions, femState) {
  if (!surfacePositions || !femState) return null;
  const nVerts = surfacePositions.count;
  // For each vertex, find a containing tet OR the closest one (so
  // verts that fall outside the tet bbox still get bound to their
  // nearest tet — typical when the surface protrudes a bit past the
  // uniform grid).
  const tetIdx = new Int32Array(nVerts);
  const bary = new Float32Array(nVerts * 4);
  const { tetsArr, restPositions, tetCount } = femState;
  for (let v = 0; v < nVerts; v++) {
    const px = surfacePositions.getX(v);
    const py = surfacePositions.getY(v);
    const pz = surfacePositions.getZ(v);
    let best = -1, bestErr = Infinity, bx = 0, by = 0, bz = 0, bw = 0;
    for (let t = 0; t < tetCount; t++) {
      const a = tetsArr[t * 4], b = tetsArr[t * 4 + 1];
      const c = tetsArr[t * 4 + 2], d = tetsArr[t * 4 + 3];
      const r = _baryInTet(
        px, py, pz,
        restPositions, a, b, c, d,
      );
      if (!r) continue;
      // Inside if all four barycentric coords are in [0, 1].
      const err = Math.max(
        Math.max(-r.x, r.x - 1),
        Math.max(-r.y, r.y - 1),
        Math.max(-r.z, r.z - 1),
        Math.max(-r.w, r.w - 1),
      );
      if (err < bestErr) {
        bestErr = err; best = t;
        bx = r.x; by = r.y; bz = r.z; bw = r.w;
        if (err <= 0) break; // strictly inside, no need to keep looking
      }
    }
    tetIdx[v] = best;
    bary[v * 4]     = bx;
    bary[v * 4 + 1] = by;
    bary[v * 4 + 2] = bz;
    bary[v * 4 + 3] = bw;
  }
  return { tetIdx, bary, vertCount: nVerts };
}

/** Write deformed positions back into `outPositions` (Three position
 * attribute) using the cached binding. */
export function applySurfaceBinding(binding, femState, outPositions) {
  if (!binding || !femState || !outPositions) return false;
  const { tetIdx, bary, vertCount } = binding;
  const { positions, tetsArr } = femState;
  for (let v = 0; v < vertCount; v++) {
    const t = tetIdx[v];
    if (t < 0) continue;
    const a = tetsArr[t * 4], b = tetsArr[t * 4 + 1];
    const c = tetsArr[t * 4 + 2], d = tetsArr[t * 4 + 3];
    const wa = bary[v * 4], wb = bary[v * 4 + 1];
    const wc = bary[v * 4 + 2], wd = bary[v * 4 + 3];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const dx = positions[d * 3], dy = positions[d * 3 + 1], dz = positions[d * 3 + 2];
    const x = ax * wa + bx * wb + cx * wc + dx * wd;
    const y = ay * wa + by * wb + cy * wc + dy * wd;
    const z = az * wa + bz * wb + cz * wc + dz * wd;
    outPositions.setXYZ(v, x, y, z);
  }
  outPositions.needsUpdate = true;
  return true;
}

// Barycentric coords of (px,py,pz) inside tet(a,b,c,d) over `nodes`.
function _baryInTet(px, py, pz, nodes, a, b, c, d) {
  const v0 = signedTetVolume(nodes, a, b, c, d);
  if (Math.abs(v0) < 1e-14) return null;
  // bary_a = vol(P, b, c, d) / vol(a, b, c, d), etc.
  const pa = _signedVolWithPoint(px, py, pz, nodes, b, c, d);
  const pb = _signedVolWithPoint(px, py, pz, nodes, a, d, c);
  const pc = _signedVolWithPoint(px, py, pz, nodes, a, b, d);
  const pd = _signedVolWithPoint(px, py, pz, nodes, a, c, b);
  return {
    x: pa / v0,
    y: pb / v0,
    z: pc / v0,
    w: pd / v0,
  };
}

// Signed volume of the tet (P, b, c, d) where P is given explicitly
// and b/c/d are node indices into `nodes`.
function _signedVolWithPoint(px, py, pz, nodes, b, c, d) {
  const bx = nodes[b * 3], by = nodes[b * 3 + 1], bz = nodes[b * 3 + 2];
  const cx = nodes[c * 3], cy = nodes[c * 3 + 1], cz = nodes[c * 3 + 2];
  const dx = nodes[d * 3], dy = nodes[d * 3 + 1], dz = nodes[d * 3 + 2];
  const e1x = bx - px, e1y = by - py, e1z = bz - pz;
  const e2x = cx - px, e2y = cy - py, e2z = cz - pz;
  const e3x = dx - px, e3y = dy - py, e3z = dz - pz;
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  return (nx * e3x + ny * e3y + nz * e3z) / 6;
}

// Silence the unused THREE import warning under strict linters.
export const __THREE_HANDLE = THREE;
