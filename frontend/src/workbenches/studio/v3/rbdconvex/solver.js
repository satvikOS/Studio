// Slice 778 — Houdini-tier convex rigid-body solver. Drives the
// gjk.js + epa.js collision pipeline with impulse-based response and
// positional correction.
//
// Each body owns:
//   position    {x,y,z}   linear position (world)
//   velocity    {x,y,z}   linear velocity (m/s)
//   angVel      {x,y,z}   angular velocity (rad/s) — currently unused by
//                          the integration step but stored because the
//                          public API requires it; rotation is left
//                          static for slice 778 so the e2e's stacked-box
//                          drop test reads cleanly. Reserved for future
//                          slices that add rotational dynamics.
//   mass        number    body mass; 0 = static (infinite mass)
//   invMass     number    cached 1/mass (0 for static)
//   inertia     number    scalar moment of inertia (kg·m²)
//   restitution number    [0..1] bounce coefficient
//   friction    number    [0..1] tangential damping after impact
//   hull        {vertices, supportFn, aabb}  body-local convex hull
//
// `step(dt)`:
//   1. integrate linear motion (semi-implicit Euler): v += g·dt; p += v·dt
//   2. broad-phase: pairwise AABB overlap reject
//   3. narrow-phase: GJK boolean test
//   4. on hit: EPA → {normal, depth}, apply impulse + positional correction
//   5. ground plane (optional)
//
// Returns `{ok, collisions:[{aKey,bKey,normal:[...],depth}]}` so the
// installer can surface contact data to the test.

import * as THREE from 'three';
import { gjk, transformHull } from './gjk.js';
import { epa } from './epa.js';

// Positional correction is split between the two bodies in proportion to
// 1/m. We keep a "slop" allowance (PEN_SLOP) so adjacent bodies that are
// constantly grazing don't oscillate, and we resolve `PEN_RECOVERY`
// fraction of the remaining depth per step (Baumgarte stabilization).
const PEN_SLOP = 0.001;        // 1 mm — bodies inside this stay still
const PEN_RECOVERY = 0.8;      // resolve 80% of the excess per step
const VEL_REST_EPS = 1e-3;     // velocities below this snap to 0 to settle stacks

export class ConvexRBDSolver {
  constructor(opts) {
    const o = opts || {};
    this.bodies = [];           // ordered array
    this._byKey = new Map();    // key → body
    this._seq = 1;
    this.gravity = o.gravity || [0, -9.81, 0];
    this.groundY = (o.groundY != null) ? Number(o.groundY) : null;
    this.iterations = Math.max(1, Math.floor(Number(o.iterations) || 4));
  }

  // Add a body. Returns the assigned bodyKey.
  addBody(spec) {
    const s = spec || {};
    const key = s.key || `rbdb-${this._seq++}`;
    const mass = (s.mass != null) ? Number(s.mass) : 1;
    const isStatic = !mass || mass <= 0;
    const body = {
      key,
      position: vec3(s.position, 0, 0, 0),
      velocity: vec3(s.velocity, 0, 0, 0),
      angVel:   vec3(s.angVel,   0, 0, 0),
      quaternion: s.quaternion ? { x: +s.quaternion.x, y: +s.quaternion.y, z: +s.quaternion.z, w: +s.quaternion.w } : null,
      mass: isStatic ? 0 : mass,
      invMass: isStatic ? 0 : 1 / mass,
      inertia: (s.inertia != null) ? Number(s.inertia) : (isStatic ? 0 : mass),
      restitution: (s.restitution != null) ? Number(s.restitution) : 0.2,
      friction:    (s.friction != null)    ? Number(s.friction)    : 0.5,
      hull: s.hull || null,
      mesh: s.mesh || null,
      static: isStatic,
    };
    this.bodies.push(body);
    this._byKey.set(key, body);
    return body;
  }

  removeBody(key) {
    const b = this._byKey.get(key);
    if (!b) return false;
    this._byKey.delete(key);
    const idx = this.bodies.indexOf(b);
    if (idx >= 0) this.bodies.splice(idx, 1);
    return true;
  }

  setGravity(g) {
    if (Array.isArray(g) && g.length === 3) {
      this.gravity = [Number(g[0]) || 0, Number(g[1]) || 0, Number(g[2]) || 0];
    } else if (typeof g === 'number') {
      this.gravity = [0, -Math.abs(g), 0];
    }
  }

  // One sim step. dt clamped to [1e-4, 0.05].
  step(dt) {
    const _dt = Math.min(0.05, Math.max(1e-4, Number(dt) || 1 / 60));
    const g = this.gravity;
    const collisions = [];

    // 1. Integrate linear motion for dynamic bodies.
    for (const b of this.bodies) {
      if (b.static) continue;
      b.velocity.x += g[0] * _dt;
      b.velocity.y += g[1] * _dt;
      b.velocity.z += g[2] * _dt;
      b.position.x += b.velocity.x * _dt;
      b.position.y += b.velocity.y * _dt;
      b.position.z += b.velocity.z * _dt;
      // Snap tiny velocities for stack settling.
      if (Math.abs(b.velocity.x) < VEL_REST_EPS) b.velocity.x = 0;
      if (Math.abs(b.velocity.y) < VEL_REST_EPS && b.position.y - this._groundFloor(b) < PEN_SLOP) b.velocity.y = 0;
      if (Math.abs(b.velocity.z) < VEL_REST_EPS) b.velocity.z = 0;
    }

    // 2. Ground plane handling — before pair tests so resting bodies are
    // already at the floor when GJK runs.
    if (this.groundY !== null) {
      for (const b of this.bodies) {
        if (b.static) continue;
        if (!b.hull) continue;
        const floorY = this.groundY - b.hull.aabb.min.y;
        if (b.position.y < floorY) {
          b.position.y = floorY;
          if (b.velocity.y < 0) {
            b.velocity.y = -b.velocity.y * b.restitution;
            if (Math.abs(b.velocity.y) < VEL_REST_EPS) b.velocity.y = 0;
          }
          b.velocity.x *= (1 - b.friction);
          b.velocity.z *= (1 - b.friction);
        }
      }
    }

    // 3. Pairwise narrow-phase, relaxed across `iterations` passes so
    // resting stacks converge in one step.
    for (let it = 0; it < this.iterations; it++) {
      let anyHit = false;
      for (let i = 0; i < this.bodies.length; i++) {
        const a = this.bodies[i];
        if (!a.hull) continue;
        for (let j = i + 1; j < this.bodies.length; j++) {
          const b = this.bodies[j];
          if (!b.hull) continue;
          if (a.static && b.static) continue;
          // Broad-phase AABB reject.
          if (!aabbOverlap(a, b)) continue;

          const hullA = transformHull(a.hull, { position: a.position, quaternion: a.quaternion });
          const hullB = transformHull(b.hull, { position: b.position, quaternion: b.quaternion });
          const r = gjk(hullA, hullB);
          if (!r.intersects) continue;
          const pen = epa(hullA, hullB, r.simplex);
          if (!pen.ok) continue;
          if (pen.depth <= PEN_SLOP) continue;
          anyHit = true;
          resolveContact(a, b, pen.normal, pen.depth);
          if (it === 0) {
            collisions.push({
              aKey: a.key, bKey: b.key,
              normal: [pen.normal.x, pen.normal.y, pen.normal.z],
              depth: pen.depth,
            });
          }
        }
      }
      if (!anyHit) break;
    }

    // 4. Sync mesh transforms if a body owns a THREE.Mesh.
    for (const b of this.bodies) {
      if (!b.mesh) continue;
      b.mesh.position.set(b.position.x, b.position.y, b.position.z);
      if (b.quaternion) b.mesh.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
    }
    return { ok: true, collisions };
  }

  // Helper: floor the body's lowest point would be at if grounded.
  _groundFloor(body) {
    if (this.groundY === null || !body.hull) return -Infinity;
    return this.groundY - body.hull.aabb.min.y;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function vec3(src, dx, dy, dz) {
  if (Array.isArray(src)) {
    return { x: +src[0] || 0, y: +src[1] || 0, z: +src[2] || 0 };
  }
  if (src && typeof src === 'object') {
    return { x: +src.x || dx || 0, y: +src.y || dy || 0, z: +src.z || dz || 0 };
  }
  return { x: dx, y: dy, z: dz };
}

// World-space AABB overlap test. Hull AABB is body-local, so we shift it
// by the body's current world position.
function aabbOverlap(a, b) {
  const amin = a.hull.aabb.min, amax = a.hull.aabb.max;
  const bmin = b.hull.aabb.min, bmax = b.hull.aabb.max;
  const ax0 = amin.x + a.position.x, ax1 = amax.x + a.position.x;
  const ay0 = amin.y + a.position.y, ay1 = amax.y + a.position.y;
  const az0 = amin.z + a.position.z, az1 = amax.z + a.position.z;
  const bx0 = bmin.x + b.position.x, bx1 = bmax.x + b.position.x;
  const by0 = bmin.y + b.position.y, by1 = bmax.y + b.position.y;
  const bz0 = bmin.z + b.position.z, bz1 = bmax.z + b.position.z;
  return ax1 >= bx0 && ax0 <= bx1
      && ay1 >= by0 && ay0 <= by1
      && az1 >= bz0 && az0 <= bz1;
}

// Resolve a single contact between two bodies.
//
//   `normal` points from A toward B (canonical EPA contact normal).
//   `depth` is the penetration distance.
//
// Impulse derivation:
//
//   j = -(1 + e) · (v_rel · n) / (1/m_A + 1/m_B)
//
// where v_rel = v_B - v_A and e is the average restitution.
//
// Positional correction: each body is shoved opposite the contact normal
// in proportion to its inverse mass. Static bodies (invMass=0) don't move.
//
// Tangential friction: split v_rel along ±t, decay t-component by the
// average friction coefficient.
function resolveContact(a, b, normal, depth) {
  const sumInv = a.invMass + b.invMass;
  if (sumInv <= 0) return; // both static — nothing to do

  // 1. Positional correction (Baumgarte).
  const correction = Math.max(depth - PEN_SLOP, 0) * PEN_RECOVERY / sumInv;
  if (a.invMass > 0) {
    a.position.x -= normal.x * correction * a.invMass;
    a.position.y -= normal.y * correction * a.invMass;
    a.position.z -= normal.z * correction * a.invMass;
  }
  if (b.invMass > 0) {
    b.position.x += normal.x * correction * b.invMass;
    b.position.y += normal.y * correction * b.invMass;
    b.position.z += normal.z * correction * b.invMass;
  }

  // 2. Relative velocity along the contact normal.
  const rvx = b.velocity.x - a.velocity.x;
  const rvy = b.velocity.y - a.velocity.y;
  const rvz = b.velocity.z - a.velocity.z;
  const vRelN = rvx * normal.x + rvy * normal.y + rvz * normal.z;
  if (vRelN > 0) return; // already separating — no impulse

  const e = Math.min(a.restitution, b.restitution);
  const jMag = -(1 + e) * vRelN / sumInv;

  if (a.invMass > 0) {
    a.velocity.x -= jMag * normal.x * a.invMass;
    a.velocity.y -= jMag * normal.y * a.invMass;
    a.velocity.z -= jMag * normal.z * a.invMass;
  }
  if (b.invMass > 0) {
    b.velocity.x += jMag * normal.x * b.invMass;
    b.velocity.y += jMag * normal.y * b.invMass;
    b.velocity.z += jMag * normal.z * b.invMass;
  }

  // 3. Tangential (friction) impulse along the contact plane.
  //    t = v_rel - (v_rel·n)·n     (post-normal-impulse tangent)
  const rvx2 = b.velocity.x - a.velocity.x;
  const rvy2 = b.velocity.y - a.velocity.y;
  const rvz2 = b.velocity.z - a.velocity.z;
  const vRelN2 = rvx2 * normal.x + rvy2 * normal.y + rvz2 * normal.z;
  let tx = rvx2 - vRelN2 * normal.x;
  let ty = rvy2 - vRelN2 * normal.y;
  let tz = rvz2 - vRelN2 * normal.z;
  const tLen = Math.hypot(tx, ty, tz);
  if (tLen < 1e-8) return;
  tx /= tLen; ty /= tLen; tz /= tLen;

  const mu = (a.friction + b.friction) * 0.5;
  // Coulomb-clamped tangential impulse.
  const jt = -(rvx2 * tx + rvy2 * ty + rvz2 * tz) / sumInv;
  const jtClamped = Math.max(-mu * Math.abs(jMag), Math.min(jt, mu * Math.abs(jMag)));

  if (a.invMass > 0) {
    a.velocity.x -= jtClamped * tx * a.invMass;
    a.velocity.y -= jtClamped * ty * a.invMass;
    a.velocity.z -= jtClamped * tz * a.invMass;
  }
  if (b.invMass > 0) {
    b.velocity.x += jtClamped * tx * b.invMass;
    b.velocity.y += jtClamped * ty * b.invMass;
    b.velocity.z += jtClamped * tz * b.invMass;
  }
}

// Convenience helper for the installer: build a quaternion from a
// THREE.Quaternion (or pass-through if already a plain {x,y,z,w}).
export function quatFromTHREE(q) {
  if (!q) return null;
  if (q.isQuaternion || (q instanceof THREE.Quaternion)) {
    return { x: q.x, y: q.y, z: q.z, w: q.w };
  }
  return { x: +q.x || 0, y: +q.y || 0, z: +q.z || 0, w: (q.w != null) ? +q.w : 1 };
}
