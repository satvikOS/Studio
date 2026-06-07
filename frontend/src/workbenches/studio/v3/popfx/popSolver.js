// ArchDisc Studio V3 — Houdini POP solver (slice 777).
//
// `POPSolver` is the step half of the POP module. It owns:
//   • `particles`  — the live particle population, each
//       { position: [x,y,z], velocity: [vx,vy,vz],
//         age: float, life: float, alive: bool, mass: float }
//   • `forces`     — an ordered list of `{ kind, params }` entries the
//                    solver iterates inside `step(dt)` once per particle
//                    (see `forces.js#applyForce`).
//   • `emitter`    — emitter shape descriptor used to seed particles at
//                    `step(dt)` time when the population is below the
//                    target `count`. Supports `point`, `box`, and
//                    `sphere` shapes (the three Houdini `popsource`
//                    primitives most graphs use).
//   • `collision`  — { plane: { y, bounce, friction } } for the basic
//                    ground-plane response Houdini's `popcollisiondetect`
//                    + `popimpactapply` ship by default. Particles
//                    bouncing off the plane keep tangential velocity
//                    (modulated by friction) and reflect the normal
//                    component (modulated by bounce).
//
// The `step(dt)` integration is semi-implicit Euler:
//   for each alive particle:
//     for each force: apply
//     position += velocity · dt
//     age      += dt
//     if age >= life → alive = false
//     handle collision plane
//
// Determinism: emitter spawn uses a seeded mulberry32 PRNG (NEVER
// `Math.random`) so two solvers with the same seed produce the same
// particle stream — the test boundary depends on this for bit-identical
// trajectory captures.
//
// Pure JS, no new deps.

import { mulberry32 } from '../common/random.js';
import { applyForce } from './forces.js';

// ─── Emitter ───────────────────────────────────────────────────────────
// Spawn a single particle from a shape descriptor and an RNG. Returns a
// fresh particle record ready to push into the pool.
function _spawnFromEmitter(emitter, rng, life) {
  const e = emitter || { shape: 'point', center: [0, 0, 0] };
  const cx = Array.isArray(e.center) ? +e.center[0] || 0 : 0;
  const cy = Array.isArray(e.center) ? +e.center[1] || 0 : 0;
  const cz = Array.isArray(e.center) ? +e.center[2] || 0 : 0;
  let px = cx, py = cy, pz = cz;
  if (e.shape === 'box') {
    const sx = +e.sizeX || 1;
    const sy = +e.sizeY || 1;
    const sz = +e.sizeZ || 1;
    px = cx + (rng() - 0.5) * sx;
    py = cy + (rng() - 0.5) * sy;
    pz = cz + (rng() - 0.5) * sz;
  } else if (e.shape === 'sphere') {
    // Uniform sample inside a sphere via rejection (rng() is uniform on
    // [0,1) so 8 samples of (-1..1) are uniform on the cube; loop until
    // we land inside the unit sphere). Bounded to 20 attempts so a
    // pathological RNG can't infinite-loop; fall through to centre.
    const r = +e.radius || 1;
    let ax = 0, ay = 0, az = 0, ok = false;
    for (let k = 0; k < 20; k++) {
      ax = (rng() - 0.5) * 2;
      ay = (rng() - 0.5) * 2;
      az = (rng() - 0.5) * 2;
      if (ax * ax + ay * ay + az * az <= 1) { ok = true; break; }
    }
    if (ok) {
      px = cx + ax * r;
      py = cy + ay * r;
      pz = cz + az * r;
    }
  }
  // Initial velocity: optional `velocity` in the emitter (vec3) plus a
  // uniform jitter sampled from `[-velocityJitter..+velocityJitter]`
  // componentwise. Defaults to zero so a pure-gravity test sees a clean
  // fall.
  const vBase = Array.isArray(e.velocity) ? e.velocity : [0, 0, 0];
  const vJit = +e.velocityJitter > 0 ? +e.velocityJitter : 0;
  const vx = (+vBase[0] || 0) + (rng() - 0.5) * 2 * vJit;
  const vy = (+vBase[1] || 0) + (rng() - 0.5) * 2 * vJit;
  const vz = (+vBase[2] || 0) + (rng() - 0.5) * 2 * vJit;
  return {
    position: [px, py, pz],
    velocity: [vx, vy, vz],
    age: 0,
    life: +life || 1,
    alive: true,
    mass: +e.mass || 1,
  };
}

// ─── POPSolver ─────────────────────────────────────────────────────────
export class POPSolver {
  constructor(opts) {
    const o = opts || {};
    // Population cap. The solver maintains an array of particles and
    // tops it up from the emitter on every step until `count` are alive.
    this.count = Math.max(1, Math.floor(+o.count || 100));
    // Per-particle randomised lifetime range (seconds). lifeMax >= lifeMin
    // is enforced; constant lifetimes use lifeMin == lifeMax.
    this.lifeMin = Math.max(0, +o.lifeMin != null ? +o.lifeMin : (+o.life || 2));
    this.lifeMax = Math.max(this.lifeMin, +o.lifeMax != null ? +o.lifeMax : this.lifeMin);
    // Emitter descriptor — defaults to a point at origin.
    this.emitter = o.emitter || { shape: 'point', center: [0, 0, 0] };
    // Force stack — `forces.js#applyForce` consumes one entry at a time.
    this.forces = Array.isArray(o.forces) ? o.forces.map((f) => ({
      kind: String(f.kind || ''),
      params: f.params || {},
    })) : [];
    // Collision config: ground plane response. Set to null to disable.
    this.collision = o.collision === undefined
      ? { plane: { y: 0, bounce: 0.45, friction: 0.2 } }
      : (o.collision || null);
    // Seeded RNG for emitter sampling.
    this.seed = Number.isFinite(+o.seed) ? (+o.seed | 0) : 0xBADC0FFE;
    this._rng = mulberry32(this.seed);
    // Backing particle array. Pre-allocated up to `count` slots so a
    // long simulation never spikes the GC.
    this.particles = [];
    this.elapsed = 0;
    // One-shot vs continuous: when `continuous` is false, the solver
    // emits the initial population on the first step and never tops up
    // after kills. Defaults to true (continuous fountain).
    this.continuous = o.continuous === undefined ? true : !!o.continuous;
    // Initial fill: pre-populate up to `count` slots so the first step
    // already has particles to advect (callers that want a delayed birth
    // can pass `prefill: false`).
    const prefill = o.prefill === undefined ? true : !!o.prefill;
    if (prefill) {
      for (let i = 0; i < this.count; i++) {
        const life = this.lifeMin + (this.lifeMax - this.lifeMin) * this._rng();
        this.particles.push(_spawnFromEmitter(this.emitter, this._rng, life));
      }
    }
  }

  // Top-level integration step. Returns `{ aliveCount }` so callers can
  // wire the result through the op surface without re-walking the pool.
  step(dt) {
    const t = Math.max(0.0001, Math.min(0.1, +dt || 0.016));
    this.elapsed += t;
    // (1) Top up the population from the emitter when continuous and
    //     below the cap. We replenish dead slots in place to keep
    //     particle indices stable (downstream code may key by index).
    if (this.continuous) {
      let aliveCount = 0;
      for (let i = 0; i < this.particles.length; i++) {
        if (this.particles[i].alive) aliveCount++;
      }
      // Refill dead slots first.
      if (aliveCount < this.count) {
        for (let i = 0; i < this.particles.length && aliveCount < this.count; i++) {
          if (!this.particles[i].alive) {
            const life = this.lifeMin + (this.lifeMax - this.lifeMin) * this._rng();
            this.particles[i] = _spawnFromEmitter(this.emitter, this._rng, life);
            aliveCount++;
          }
        }
      }
      // If the array isn't sized yet (e.g. prefill: false), append new
      // slots up to the cap.
      while (this.particles.length < this.count) {
        const life = this.lifeMin + (this.lifeMax - this.lifeMin) * this._rng();
        this.particles.push(_spawnFromEmitter(this.emitter, this._rng, life));
      }
    }

    // (2) Force pass + integrate + age + collide.
    let aliveCount = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      if (!p.alive) continue;
      // Apply every force in registration order.
      for (let k = 0; k < this.forces.length; k++) {
        const f = this.forces[k];
        applyForce(p, f.kind, f.params, this.elapsed, t);
      }
      // Position update.
      p.position[0] += p.velocity[0] * t;
      p.position[1] += p.velocity[1] * t;
      p.position[2] += p.velocity[2] * t;
      // Age + kill.
      p.age += t;
      if (p.age >= p.life) {
        p.alive = false;
        continue;
      }
      // Collision plane (ground).
      if (this.collision && this.collision.plane) {
        const plane = this.collision.plane;
        const planeY = +plane.y || 0;
        if (p.position[1] < planeY) {
          p.position[1] = planeY;
          const bounce = +plane.bounce != null ? +plane.bounce : 0.45;
          const friction = +plane.friction != null ? +plane.friction : 0.2;
          // Reflect normal component (Y); damp tangential by friction.
          if (p.velocity[1] < 0) {
            p.velocity[1] = -p.velocity[1] * bounce;
          }
          const kFric = Math.max(0, 1 - friction);
          p.velocity[0] *= kFric;
          p.velocity[2] *= kFric;
        }
      }
      aliveCount++;
    }
    return { aliveCount };
  }

  // Append a force to the stack. Returns the new force list length so
  // callers can sanity-check the surface op.
  addForce(kind, params) {
    if (!kind) return this.forces.length;
    this.forces.push({ kind: String(kind), params: params || {} });
    return this.forces.length;
  }

  // First `n` alive particles' positions. Used by the op surface to
  // give tests a way to assert particles moved without grovelling the
  // raw array.
  samplePositions(n) {
    const out = [];
    const cap = Math.max(0, Math.floor(+n) || 0);
    for (let i = 0; i < this.particles.length && out.length < cap; i++) {
      const p = this.particles[i];
      if (!p.alive) continue;
      out.push([p.position[0], p.position[1], p.position[2]]);
    }
    return out;
  }

  aliveCount() {
    let n = 0;
    for (let i = 0; i < this.particles.length; i++) {
      if (this.particles[i].alive) n++;
    }
    return n;
  }
}

export default POPSolver;
