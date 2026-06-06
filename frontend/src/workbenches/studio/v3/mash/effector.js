// Slice 753 — Maya MASH effectors (sine / noise / falloff / random /
// step). Each is a pure per-instance function returning a delta:
//
//   { posOffset: [dx, dy, dz], rotOffset: [rx, ry, rz], scaleMul: [sx, sy, sz] }
//
// `base` is the original `Matrix4.elements` for this instance — used by
// the falloff effector to read its world position. None of the effectors
// touch global state; the arrange.js stack composes them deterministically.
//
// Hard rule (per slice spec): NEVER call Math.random. Anything labelled
// random/noise routes through `seededRandom01` so two evaluations of the
// same network produce bit-identical matrices.

import { seededRandom01 } from '../common/random.js';

function _axisIdx(axis) {
  if (axis === 'x') return 0;
  if (axis === 'z') return 2;
  return 1; // default y
}

function _zeroDelta() {
  return { posOffset: [0, 0, 0], rotOffset: [0, 0, 0], scaleMul: [1, 1, 1] };
}

// ── sine ─────────────────────────────────────────────────────────────
// posOffset on `axis` = sin(idx * frequency + phase) * amplitude.
export function sineEffector(idx, base, params) {
  const p = params || {};
  const axis = p.axis || 'y';
  const amplitude = Number(p.amplitude) || 0;
  const frequency = (p.frequency === undefined) ? 0.1 : Number(p.frequency);
  const phase = Number(p.phase) || 0;
  const d = _zeroDelta();
  const v = Math.sin(idx * frequency + phase) * amplitude;
  d.posOffset[_axisIdx(axis)] = v;
  return d;
}

// ── noise ────────────────────────────────────────────────────────────
// Deterministic hash-based pseudo-noise. NEVER Math.random. `freq`
// stretches the seed lookup across the index domain so spatially-near
// instances get visually-similar offsets without being identical.
export function noiseEffector(idx, base, params) {
  const p = params || {};
  const axis = p.axis || 'y';
  const amplitude = Number(p.amplitude) || 0;
  const freq = (p.freq === undefined) ? 1 : Number(p.freq);
  const seed = (p.seed === undefined) ? 1337 : (p.seed | 0);
  const d = _zeroDelta();
  // Stretch index through `freq` then bias to [-1, 1].
  const key = Math.floor(idx * freq);
  const u = seededRandom01(seed, key);
  const v = (u - 0.5) * 2 * amplitude;
  d.posOffset[_axisIdx(axis)] = v;
  return d;
}

// ── falloff ──────────────────────────────────────────────────────────
// Distance-from-center scaling. Reads the instance's translation from
// the base matrix elements (column-major; tx/ty/tz at indices 12/13/14)
// so it sees the pre-effector position, not the stacked one.
export function falloffEffector(idx, base, params) {
  const p = params || {};
  const center = Array.isArray(p.center) ? p.center : [0, 0, 0];
  const radius = Number(p.radius) || 1;
  const scaleMul = Number(p.scaleMul) || 1;
  const d = _zeroDelta();
  if (!base || base.length < 16) return d;
  const dx = base[12] - center[0];
  const dy = base[13] - center[1];
  const dz = base[14] - center[2];
  const dist = Math.hypot(dx, dy, dz);
  const w = Math.max(0, 1 - dist / Math.max(1e-9, radius));
  const factor = 1 + (scaleMul - 1) * w;
  d.scaleMul = [factor, factor, factor];
  return d;
}

// ── random ───────────────────────────────────────────────────────────
// Deterministic seed-based posOffset over [-range, +range] on `axis`.
// Different per-instance offsets via `seededRandom01(seed, idx)`.
export function randomEffector(idx, base, params) {
  const p = params || {};
  const seed = (p.seed === undefined) ? 7 : (p.seed | 0);
  const axis = p.axis || 'y';
  const range = Number(p.range) || 0;
  const d = _zeroDelta();
  const u = seededRandom01(seed, idx);
  const v = (u - 0.5) * 2 * range;
  d.posOffset[_axisIdx(axis)] = v;
  return d;
}

// ── step ─────────────────────────────────────────────────────────────
// Every Nth instance gets perturbed by `amount` on `axis`. Maya's
// "Step" effector — used for stair-stepping a linear distribute.
export function stepEffector(idx, base, params) {
  const p = params || {};
  const axis = p.axis || 'y';
  const every = Math.max(1, (p.every | 0) || 1);
  const amount = Number(p.amount) || 0;
  const d = _zeroDelta();
  if (every > 0 && (idx % every) === 0) {
    d.posOffset[_axisIdx(axis)] = amount;
  }
  return d;
}

export const EFFECTOR_KINDS = {
  sine: sineEffector,
  noise: noiseEffector,
  falloff: falloffEffector,
  random: randomEffector,
  step: stepEffector,
};
