// ArchDisc Studio V3 — foliage wind sway.
//
// `setWind(scatterUuid, strength)` rotates every instance of a foliage
// scatter slightly each frame by a sin-wave offset on its Y axis.
// Strength is in radians of peak deflection (0 = no sway, 0.3 ≈ ~17°).
//
// Per-instance phase offset is derived deterministically from the
// instance index + the foliage seed so the field doesn't look like
// every blade is rotating in lockstep — every clone hits its peak at
// a slightly different time. The offset is layered on top of the
// instance's BASE rotation (snapshot at scatter time), so wind never
// accumulates / drifts and we can change strength live without resetting.
//
// Chain semantics: chained.__foliageWind = true + __prev = prevTick,
// mirrors the LOD / FX / sim pattern. `removeWind(uuid)` clears the
// per-foliage entry; the tick auto-uninstalls when zero windy
// scatters remain.

import * as THREE from 'three';
import { findFoliageByUuid, __internal as scatterInt } from './scatter.js';

const TAG = scatterInt.FOLIAGE_TAG;

const _winds = new Map(); // scatterUuid → { inst, strength, freq, phases }

function viewport() {
  return (typeof window !== 'undefined') ? (window.__archdiscViewport || null) : null;
}

// Cheap hash → [0, 2π). Seeded from foliage seed so wind matches across runs.
function phaseFor(seed, i) {
  let h = (seed ^ (i * 0x9E3779B1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85EBCA6B);
  h = Math.imul(h ^ (h >>> 13), 0xC2B2AE35);
  h ^= h >>> 16;
  return (h / 4294967296) * Math.PI * 2;
}

// Module-level start time (perf.now()-style) so we can produce
// continuous, paused-test-friendly time values without per-frame deltas.
let _startMs = (typeof performance !== 'undefined') ? performance.now() : Date.now();

function windFrame(nowMs) {
  const now = (typeof nowMs === 'number')
    ? nowMs
    : ((typeof performance !== 'undefined') ? performance.now() : Date.now());
  const t = (now - _startMs) / 1000;
  const dummy = new THREE.Object3D();
  _winds.forEach((rec) => {
    const inst = rec.inst;
    if (!inst || !inst.userData || !inst.userData[TAG]) return;
    const meta = inst.userData[TAG];
    const N = inst.count;
    const positions = meta.positions;
    const baseRot = meta.baseRot;
    const baseScale = meta.baseScale;
    // Ensure phase table grew if paint added instances.
    if (rec.phases.length < N) {
      const next = new Float32Array(N);
      next.set(rec.phases);
      const seed = meta.seed | 0;
      for (let i = rec.phases.length; i < N; i++) next[i] = phaseFor(seed, i);
      rec.phases = next;
    }
    // When LOD is active for this scatter, LOD owns the matrix writes
    // (it inlines its own wind sway via __internal.getWindRec). We bail
    // out here so the two ticks don't fight over the matrix slots.
    const lodActive = !!(meta.lod && meta.lod.lowInst);
    if (lodActive) return;
    for (let i = 0; i < N; i++) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      const phase = rec.phases[i];
      const offset = Math.sin(t * rec.freq + phase) * rec.strength;
      dummy.position.set(px, py, pz);
      dummy.rotation.set(0, baseRot[i] + offset, 0);
      const s = baseScale[i];
      dummy.scale.set(s, s, s);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    }
    inst.instanceMatrix.needsUpdate = true;
  });
}

function _hasWindTickIn(v) {
  let cur = v.__studioAnimTick;
  while (cur) {
    if (cur.__foliage) return true;
    cur = cur.__prev;
  }
  return false;
}

function _ensureWindTick() {
  const v = viewport();
  if (!v) return false;
  if (_hasWindTickIn(v)) return true;
  const prev = v.__studioAnimTick;
  const chained = (now) => {
    try { windFrame(now); } catch (_) {}
    if (prev) { try { prev(now); } catch (_) {} }
  };
  // Per spec: tagged `__foliage` (matches the goal text exactly).
  chained.__foliage = true;
  chained.__prev = prev;
  v.__studioAnimTick = chained;
  return true;
}

function _removeWindTickIfEmpty() {
  if (_winds.size > 0) return;
  const v = viewport(); if (!v) return;
  const links = [];
  let cur = v.__studioAnimTick;
  while (cur) { links.push(cur); cur = cur.__prev; }
  const kept = links.filter((l) => !l.__foliage);
  for (let i = 0; i < kept.length - 1; i++) kept[i].__prev = kept[i + 1];
  if (kept.length) kept[kept.length - 1].__prev = null;
  v.__studioAnimTick = kept[0] || null;
}

// ─── Public ─────────────────────────────────────────────────────────────
export function setWind(scatterUuid, strength) {
  const inst = findFoliageByUuid(scatterUuid);
  if (!inst) return { ok: false, error: 'no foliage scatter by uuid' };
  const S = Math.max(0, +strength || 0);
  if (S === 0) {
    // Remove wind: restore base matrices.
    const prev = _winds.get(scatterUuid);
    if (prev) {
      const meta = inst.userData[TAG];
      const N = inst.count;
      for (let i = 0; i < N; i++) inst.setMatrixAt(i, meta.baseMatrices[i]);
      inst.instanceMatrix.needsUpdate = true;
      _winds.delete(scatterUuid);
      if (meta.wind) meta.wind = null;
      _removeWindTickIfEmpty();
    }
    return { ok: true, scatterUuid, strength: 0 };
  }
  const meta = inst.userData[TAG];
  const N = inst.count;
  const phases = new Float32Array(N);
  const seed = meta.seed | 0;
  for (let i = 0; i < N; i++) phases[i] = phaseFor(seed, i);
  const rec = {
    inst,
    strength: S,
    freq: 1.8, // rad/s — gentle sin oscillation
    phases,
  };
  _winds.set(scatterUuid, rec);
  if (meta) meta.wind = { strength: S, freq: rec.freq };
  _ensureWindTick();
  // Run one frame immediately so the swayed state is visible before
  // the next paint — also makes tests deterministic.
  try { windFrame(); } catch (_) {}
  return { ok: true, scatterUuid, strength: S };
}

export function clearWind(scatterUuid) {
  return setWind(scatterUuid, 0);
}

export function listWind() {
  const arr = [];
  _winds.forEach((rec, scatterUuid) => {
    arr.push({
      scatterUuid,
      strength: rec.strength,
      freq: rec.freq,
    });
  });
  return { ok: true, count: arr.length, winds: arr };
}

// Used by paint.js after it swaps the inst for a larger one.
export function rebindWindInst(scatterUuid, newInst) {
  const rec = _winds.get(scatterUuid);
  if (!rec) return false;
  rec.inst = newInst;
  return true;
}

export const __internal = {
  _winds,
  windFrame,
  phaseFor,
  startMs: () => _startMs,
  getWindRec: (uuid) => _winds.get(uuid) || null,
};
