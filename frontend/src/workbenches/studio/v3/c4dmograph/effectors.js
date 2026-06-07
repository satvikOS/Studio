// Slice 773 — Cinema 4D MoGraph effectors that drive a Matrix
// object's per-instance transforms.
//
// C4D's effector model is slightly different from Maya MASH's
// (slice 753 mash/effector.js). MASH effectors are pure index ->
// delta functions stacked atop a baseMatrices snapshot. C4D
// effectors instead READ AND WRITE the Matrix object's current
// transform array — Plain rewrites every instance uniformly,
// Delay sweeps each instance toward its parameter target over
// time, Inheritance interpolates one Matrix toward another, and
// Random adds deterministic per-instance noise. The matrices in
// the array ARE the state — there's no separate "evaluated"
// composition step.
//
// All four effectors are pure (no scene mutation, no DOM, no
// __archdiscScene access) so the test pipeline can hit them
// directly. Determinism: NEVER Math.random — the Random effector
// routes through seededRandom01.
//
// Returns Matrix4[] for each effector. The ops layer (index.js)
// writes the result back into the Matrix object's storage via
// setMatrices().

import * as THREE from 'three';
import { seededRandom01 } from '../common/random.js';

// Decompose a Matrix4's elements into translation/quat/scale
// vectors. Allocates fresh vectors each call so the result is safe
// to keep across iterations; the per-instance hot loops below use
// scratch vectors instead.
function _decompose(elems) {
  const m = new THREE.Matrix4().fromArray(elems);
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();
  m.decompose(p, q, s);
  return { p, q, s };
}

// ── Plain effector ────────────────────────────────────────────────
// C4D's Plain effector applies a UNIFORM offset / rotation / scale
// to every instance in the Matrix object's array. No falloff, no
// per-instance variation — that's what the other effectors are for.
//
// Params: { offset: [x,y,z], rotation: [rx,ry,rz], scale: [sx,sy,sz] }
//
// Composition: T_new = T_old * Δ where Δ is composed from offset
// (added to position), rotation (multiplied into orientation), and
// scale (multiplied into scale). Matches C4D's default Plain
// effector "Transform Mode = Add" behaviour.
export function plainEffector(matrices, params) {
  const p = params || {};
  const off = Array.isArray(p.offset) ? p.offset : [0, 0, 0];
  const rot = Array.isArray(p.rotation) ? p.rotation : [0, 0, 0];
  const scl = Array.isArray(p.scale) ? p.scale : [1, 1, 1];
  const N = matrices.length;
  const out = new Array(N);
  const tmpP = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const offQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  const reuse = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    reuse.copy(matrices[i]);
    reuse.decompose(tmpP, tmpQ, tmpS);
    tmpP.x += off[0]; tmpP.y += off[1]; tmpP.z += off[2];
    tmpQ.multiply(offQ);
    tmpS.x *= scl[0]; tmpS.y *= scl[1]; tmpS.z *= scl[2];
    const composed = new THREE.Matrix4();
    composed.compose(tmpP, tmpQ, tmpS);
    out[i] = composed;
  }
  return out;
}

// ── Delay effector ────────────────────────────────────────────────
// C4D's Delay effector is the canonical MoGraph "sweep" tool: each
// instance reaches its target state delayed by `i * framesPerInstance`
// frames. By `currentFrame`, instance i has interpolated to
// t_i = clamp01((currentFrame - i*framesPerInstance) / smooth) of
// the way toward the target.
//
// Here we read the base snapshot (the unperturbed matrix array) +
// a target value computed from `params.target` (a uniform offset
// applied as the destination). Each instance gets a fraction t_i ∈
// [0, 1] of the target offset added to its base position.
//
// Params: {
//   target:           [tx, ty, tz]  // the destination offset
//   framesPerInstance: number       // sweep interval
//   smooth:           number        // optional easing window, default 1
// }
//
// Returns a snapshot Matrix4[] AND a per-instance `t` array so the
// ops layer can report progress without re-derivation.
export function delayEffector(matrices, params, frame, base) {
  const p = params || {};
  const target = Array.isArray(p.target) ? p.target : [0, 0, 0];
  const framesPerInstance = (p.framesPerInstance === undefined) ? 1 : Number(p.framesPerInstance);
  const smooth = (p.smooth === undefined) ? 1 : Number(p.smooth);
  const f = Number(frame) || 0;
  const N = matrices.length;
  const baseSrc = (Array.isArray(base) && base.length === N) ? base : null;
  const out = new Array(N);
  const ts = new Array(N);
  const tmpP = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const reuse = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    if (baseSrc) {
      reuse.fromArray(baseSrc[i]);
    } else {
      reuse.copy(matrices[i]);
    }
    reuse.decompose(tmpP, tmpQ, tmpS);
    // Delay sweep: instance i starts catching up at frame i*framesPerInstance,
    // reaches the target after `smooth` frames more.
    const startFrame = i * framesPerInstance;
    const denom = Math.max(1e-9, smooth);
    let t = (f - startFrame) / denom;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    ts[i] = t;
    tmpP.x += target[0] * t;
    tmpP.y += target[1] * t;
    tmpP.z += target[2] * t;
    const composed = new THREE.Matrix4();
    composed.compose(tmpP, tmpQ, tmpS);
    out[i] = composed;
  }
  return { matrices: out, ts };
}

// ── Inheritance effector ──────────────────────────────────────────
// Interpolate each matrix in `matrices` toward the corresponding
// matrix in `sourceMatrices` by `mix ∈ [0, 1]`. Lengths must match.
//
// Cinema 4D's Inheritance effector lets you "hand off" between two
// Cloners — e.g. a grid arrangement morphing into a radial one over
// time. Here we lerp position, slerp rotation, and lerp scale. mix=0
// returns the original, mix=1 returns the source.
export function inheritanceEffector(matrices, sourceMatrices, mix) {
  const m = Math.max(0, Math.min(1, Number(mix)));
  const N = matrices.length;
  const Ns = (sourceMatrices && sourceMatrices.length) || 0;
  if (Ns === 0) return matrices.slice(0);
  const out = new Array(N);
  const tmpPa = new THREE.Vector3();
  const tmpQa = new THREE.Quaternion();
  const tmpSa = new THREE.Vector3();
  const tmpPb = new THREE.Vector3();
  const tmpQb = new THREE.Quaternion();
  const tmpSb = new THREE.Vector3();
  const reuseA = new THREE.Matrix4();
  const reuseB = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    reuseA.copy(matrices[i]);
    reuseA.decompose(tmpPa, tmpQa, tmpSa);
    reuseB.copy(sourceMatrices[i % Ns]);
    reuseB.decompose(tmpPb, tmpQb, tmpSb);
    // lerp position
    tmpPa.x += (tmpPb.x - tmpPa.x) * m;
    tmpPa.y += (tmpPb.y - tmpPa.y) * m;
    tmpPa.z += (tmpPb.z - tmpPa.z) * m;
    // slerp rotation
    tmpQa.slerp(tmpQb, m);
    // lerp scale
    tmpSa.x += (tmpSb.x - tmpSa.x) * m;
    tmpSa.y += (tmpSb.y - tmpSa.y) * m;
    tmpSa.z += (tmpSb.z - tmpSa.z) * m;
    const composed = new THREE.Matrix4();
    composed.compose(tmpPa, tmpQa, tmpSa);
    out[i] = composed;
  }
  return out;
}

// ── Random effector ───────────────────────────────────────────────
// C4D-flavour Random effector: deterministic per-instance offset
// derived from `seed`. Adds noise on all three axes within the
// supplied per-axis range. Different naming convention from MASH's
// random effector (which only perturbs one axis) — C4D's Random
// effector is full XYZ.
//
// Params: { range: [rx, ry, rz], seed: integer }
export function randomEffectorC4D(matrices, params) {
  const p = params || {};
  const range = Array.isArray(p.range) ? p.range : [0, 0, 0];
  const seed = (p.seed === undefined) ? 1337 : (p.seed | 0);
  const N = matrices.length;
  const out = new Array(N);
  const tmpP = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  const reuse = new THREE.Matrix4();
  for (let i = 0; i < N; i++) {
    reuse.copy(matrices[i]);
    reuse.decompose(tmpP, tmpQ, tmpS);
    const ux = seededRandom01(seed, i * 3);
    const uy = seededRandom01(seed, i * 3 + 1);
    const uz = seededRandom01(seed, i * 3 + 2);
    tmpP.x += (ux - 0.5) * 2 * range[0];
    tmpP.y += (uy - 0.5) * 2 * range[1];
    tmpP.z += (uz - 0.5) * 2 * range[2];
    const composed = new THREE.Matrix4();
    composed.compose(tmpP, tmpQ, tmpS);
    out[i] = composed;
  }
  return out;
}
