// ArchDisc Studio V3 — Unreal Niagara-style real-time particle emitter
// (slice 764).
//
// `Emitter` is the simulation half of the module. It owns the particle
// state arrays (pre-allocated to the population cap for stable GC — no
// per-frame allocations after construction) and advances them one
// timestep at a time inside `update(dt)`.
//
// The state model mirrors Niagara's per-particle attribute surface:
//   • position  — Float32Array(cap * 3)
//   • velocity  — Float32Array(cap * 3)
//   • age       — Float32Array(cap)
//   • life      — Float32Array(cap)
//   • size      — Float32Array(cap)
//   • color     — Float32Array(cap * 3)
//   • alive     — Uint8Array(cap) — 0 = dead slot, 1 = live particle
//
// Each frame `update(dt)` does:
//   (1) Spawn — drain a fractional accumulator at `spawnRate` particles
//       per second, look for a dead slot to recycle, and initialise it
//       (random velocity in [velocityMin..velocityMax], random life in
//       [lifeMin..lifeMax]).
//   (2) Integrate — for every alive slot:
//        v += gravity * dt
//        v *= (1 - drag * dt)    (linear damping)
//        p += v * dt
//        age += dt
//   (3) Sample curves — evaluate colorOverLife + sizeOverLife at
//       `t = age / life` and write the result to the per-particle
//       colour + size arrays.
//   (4) Kill — when age >= life, flip alive[i] = 0 so the next spawn
//       can recycle the slot.
//
// The colour curve is a piecewise-linear gradient (array of stops with
// `t` ∈ [0,1] + an RGB triple). The size curve is a piecewise-linear
// scalar curve in the same form. Both default to sensible Niagara
// presets so a fresh `new Emitter()` immediately produces a visible
// fountain.
//
// Determinism: the emitter is seeded by `seed` (mulberry32). All
// per-particle randomness flows through that RNG so spawning the same
// emitter twice produces bit-identical particle streams. NEVER calls
// Math.random — the in-house seeded RNG is the only randomness source.

import { mulberry32 } from '../common/random.js';

// ─── Curve helpers ─────────────────────────────────────────────────────

// Sample a piecewise-linear gradient. `stops` is an array of
// `{ t: 0..1, rgb: [r, g, b] }` ordered by t. Edge stops are clamped.
// Output is written into `out` at offset `outIdx` (RGB triple).
export function sampleGradient(stops, t, out, outIdx) {
  const tt = t < 0 ? 0 : (t > 1 ? 1 : t);
  const n = stops.length;
  if (n === 0) {
    out[outIdx] = 1; out[outIdx + 1] = 1; out[outIdx + 2] = 1;
    return;
  }
  if (n === 1 || tt <= stops[0].t) {
    out[outIdx]     = stops[0].rgb[0];
    out[outIdx + 1] = stops[0].rgb[1];
    out[outIdx + 2] = stops[0].rgb[2];
    return;
  }
  if (tt >= stops[n - 1].t) {
    out[outIdx]     = stops[n - 1].rgb[0];
    out[outIdx + 1] = stops[n - 1].rgb[1];
    out[outIdx + 2] = stops[n - 1].rgb[2];
    return;
  }
  // Find the bracketing pair.
  for (let i = 0; i < n - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (tt >= a.t && tt <= b.t) {
      const span = b.t - a.t;
      const k = span > 1e-9 ? (tt - a.t) / span : 0;
      out[outIdx]     = a.rgb[0] + (b.rgb[0] - a.rgb[0]) * k;
      out[outIdx + 1] = a.rgb[1] + (b.rgb[1] - a.rgb[1]) * k;
      out[outIdx + 2] = a.rgb[2] + (b.rgb[2] - a.rgb[2]) * k;
      return;
    }
  }
  // Should be unreachable, but write a sane fallback.
  out[outIdx]     = stops[n - 1].rgb[0];
  out[outIdx + 1] = stops[n - 1].rgb[1];
  out[outIdx + 2] = stops[n - 1].rgb[2];
}

// Sample a piecewise-linear scalar curve. `stops` is an array of
// `{ t: 0..1, v: number }` ordered by t. Edge stops are clamped.
export function sampleCurve(stops, t) {
  const tt = t < 0 ? 0 : (t > 1 ? 1 : t);
  const n = stops.length;
  if (n === 0) return 1;
  if (n === 1 || tt <= stops[0].t) return stops[0].v;
  if (tt >= stops[n - 1].t) return stops[n - 1].v;
  for (let i = 0; i < n - 1; i++) {
    const a = stops[i];
    const b = stops[i + 1];
    if (tt >= a.t && tt <= b.t) {
      const span = b.t - a.t;
      const k = span > 1e-9 ? (tt - a.t) / span : 0;
      return a.v + (b.v - a.v) * k;
    }
  }
  return stops[n - 1].v;
}

// ─── Defaults ──────────────────────────────────────────────────────────

const DEFAULT_COLOR_OVER_LIFE = [
  { t: 0.0, rgb: [1.0, 0.85, 0.4] },   // warm spark birth
  { t: 0.5, rgb: [1.0, 0.4, 0.1] },    // orange ember
  { t: 1.0, rgb: [0.05, 0.05, 0.05] }, // cooled-ash death
];

const DEFAULT_SIZE_OVER_LIFE = [
  { t: 0.0, v: 0.0 },  // grow in
  { t: 0.2, v: 1.0 },  // peak
  { t: 1.0, v: 0.0 },  // shrink out
];

// ─── Emitter ──────────────────────────────────────────────────────────

export class Emitter {
  constructor(opts) {
    const o = opts || {};
    this.count = Math.max(1, Math.floor(+o.count || 256));
    this.spawnRate = Math.max(0, +o.spawnRate || 60);

    // Per-particle randomised ranges.
    this.lifeMin = Math.max(0, +o.lifeMin || 1.0);
    this.lifeMax = Math.max(this.lifeMin, +o.lifeMax || 2.0);

    // Velocity init is sampled uniformly in [min..max] componentwise.
    this.velocityMin = Array.isArray(o.velocityMin) && o.velocityMin.length === 3
      ? [+o.velocityMin[0] || 0, +o.velocityMin[1] || 0, +o.velocityMin[2] || 0]
      : [-0.5, 0.5, -0.5];
    this.velocityMax = Array.isArray(o.velocityMax) && o.velocityMax.length === 3
      ? [+o.velocityMax[0] || 0, +o.velocityMax[1] || 0, +o.velocityMax[2] || 0]
      : [0.5, 2.0, 0.5];

    // Forces.
    this.gravity = Array.isArray(o.gravity) && o.gravity.length === 3
      ? [+o.gravity[0] || 0, +o.gravity[1] || 0, +o.gravity[2] || 0]
      : [0, -9.8, 0];
    this.drag = Math.max(0, +o.drag || 0.1);

    // Spawn origin in world space.
    this.origin = Array.isArray(o.origin) && o.origin.length === 3
      ? [+o.origin[0] || 0, +o.origin[1] || 0, +o.origin[2] || 0]
      : [0, 0, 0];

    // Curves.
    this.colorOverLife = Array.isArray(o.colorOverLife) && o.colorOverLife.length > 0
      ? o.colorOverLife.map((s) => ({
          t: Math.max(0, Math.min(1, +s.t || 0)),
          rgb: [
            +s.rgb[0] || 0,
            +s.rgb[1] || 0,
            +s.rgb[2] || 0,
          ],
        }))
      : DEFAULT_COLOR_OVER_LIFE.slice();
    this.sizeOverLife = Array.isArray(o.sizeOverLife) && o.sizeOverLife.length > 0
      ? o.sizeOverLife.map((s) => ({
          t: Math.max(0, Math.min(1, +s.t || 0)),
          v: +s.v || 0,
        }))
      : DEFAULT_SIZE_OVER_LIFE.slice();
    this.baseSize = Math.max(0, +o.baseSize || 0.1);

    this.seed = Number.isFinite(+o.seed) ? (+o.seed | 0) : 0xC0FFEE;
    this._rng = mulberry32(this.seed);

    // Pre-allocated state arrays — never resized.
    this.positions = new Float32Array(this.count * 3);
    this.velocities = new Float32Array(this.count * 3);
    this.ages = new Float32Array(this.count);
    this.lives = new Float32Array(this.count);
    this.sizes = new Float32Array(this.count);
    this.colors = new Float32Array(this.count * 3);
    this.alive = new Uint8Array(this.count);

    // Simulation bookkeeping.
    this.aliveCount = 0;
    this._spawnAcc = 0;       // fractional accumulator: ≥1 spawn next
    this._nextFreeHint = 0;   // round-robin scan start for slot recycling
    this.elapsed = 0;         // total simulated time (seconds)
  }

  // Initialise a single slot. Index must be in [0, count).
  _spawnAt(i) {
    const r = this._rng;
    const px = this.origin[0];
    const py = this.origin[1];
    const pz = this.origin[2];
    this.positions[i * 3]     = px;
    this.positions[i * 3 + 1] = py;
    this.positions[i * 3 + 2] = pz;
    const vmin = this.velocityMin;
    const vmax = this.velocityMax;
    this.velocities[i * 3]     = vmin[0] + (vmax[0] - vmin[0]) * r();
    this.velocities[i * 3 + 1] = vmin[1] + (vmax[1] - vmin[1]) * r();
    this.velocities[i * 3 + 2] = vmin[2] + (vmax[2] - vmin[2]) * r();
    this.ages[i] = 0;
    this.lives[i] = this.lifeMin + (this.lifeMax - this.lifeMin) * r();
    // Initial size + colour sample at t = 0 so a single-frame readback
    // returns sane values before the next update integrates anything.
    this.sizes[i] = this.baseSize * sampleCurve(this.sizeOverLife, 0);
    sampleGradient(this.colorOverLife, 0, this.colors, i * 3);
    this.alive[i] = 1;
    this.aliveCount++;
  }

  // Round-robin scan for a dead slot. Returns -1 if every slot is live.
  _findFreeSlot() {
    const cap = this.count;
    for (let k = 0; k < cap; k++) {
      const i = (this._nextFreeHint + k) % cap;
      if (!this.alive[i]) {
        this._nextFreeHint = (i + 1) % cap;
        return i;
      }
    }
    return -1;
  }

  // Drain the spawn accumulator + integrate one timestep. `dt` is
  // clamped to [0.001, 0.1] so a frame-skip can't teleport particles to
  // infinity. Returns the new aliveCount.
  update(dt) {
    const step = Math.max(0.001, Math.min(0.1, +dt || 0.016));

    // (1) Spawn — accumulate fractional particles up to the cap.
    this._spawnAcc += step * this.spawnRate;
    while (this._spawnAcc >= 1) {
      this._spawnAcc -= 1;
      if (this.aliveCount >= this.count) break;
      const slot = this._findFreeSlot();
      if (slot < 0) break;
      this._spawnAt(slot);
    }

    // (2) Integrate + (3) sample curves + (4) kill.
    const gx = this.gravity[0];
    const gy = this.gravity[1];
    const gz = this.gravity[2];
    const dampFactor = Math.max(0, 1 - this.drag * step);
    const cap = this.count;
    for (let i = 0; i < cap; i++) {
      if (!this.alive[i]) continue;
      // Age + kill check first so we don't waste integration on a slot
      // that's already past life.
      this.ages[i] += step;
      if (this.ages[i] >= this.lives[i]) {
        this.alive[i] = 0;
        this.aliveCount--;
        // Zero the size so a stale draw before the next render sees a
        // collapsed billboard rather than the last sampled value.
        this.sizes[i] = 0;
        continue;
      }
      // Forces: gravity then linear drag.
      this.velocities[i * 3]     = (this.velocities[i * 3]     + gx * step) * dampFactor;
      this.velocities[i * 3 + 1] = (this.velocities[i * 3 + 1] + gy * step) * dampFactor;
      this.velocities[i * 3 + 2] = (this.velocities[i * 3 + 2] + gz * step) * dampFactor;
      // Position update.
      this.positions[i * 3]     += this.velocities[i * 3]     * step;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * step;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * step;
      // Sample curves at the new age fraction.
      const tt = this.ages[i] / this.lives[i];
      this.sizes[i] = this.baseSize * sampleCurve(this.sizeOverLife, tt);
      sampleGradient(this.colorOverLife, tt, this.colors, i * 3);
    }

    this.elapsed += step;
    return this.aliveCount;
  }

  // Reset every slot to dead and re-seed the RNG. Used by tests + the
  // `Stop` op so a paused emitter can be re-armed clean.
  reset() {
    this.alive.fill(0);
    this.aliveCount = 0;
    this._spawnAcc = 0;
    this._nextFreeHint = 0;
    this.elapsed = 0;
    this._rng = mulberry32(this.seed);
    // Don't bother zeroing positions/velocities/ages — `alive` gates
    // every read in render/sample paths.
  }

  // First `n` alive particles' position + remaining life. Used by the
  // op surface to give tests a way to assert that integration moved
  // particles without forcing them to grovel through the raw buffers.
  sampleAlive(n) {
    const out = [];
    const cap = this.count;
    let taken = 0;
    for (let i = 0; i < cap && taken < n; i++) {
      if (!this.alive[i]) continue;
      out.push({
        pos: [
          this.positions[i * 3],
          this.positions[i * 3 + 1],
          this.positions[i * 3 + 2],
        ],
        life: this.lives[i] - this.ages[i],
      });
      taken++;
    }
    return out;
  }
}

export default Emitter;
