// Slice 767 — Houdini RBD destruction: rigid-body sim driver for chunks.
//
// Each fracture chunk becomes a rigid body with a position, velocity,
// and axis-aligned bounding box. Integration is semi-implicit (symplectic)
// Euler: vel += gravity·dt; pos += vel·dt; that order keeps the sim
// stable at the dt values used by the e2e (1/60s) without bringing in a
// proper Verlet or RK4 step. Collisions are bbox-vs-bbox AABB overlap;
// on overlap we push the bodies apart along the shallowest penetration
// axis and reflect the relative velocity component along that axis with
// per-body restitution. Plus a ground plane at y = ground.y mirroring
// the DOPs solver convention.
//
// A small "resting" heuristic skips integration when both position-delta
// and velocity magnitude fall below threshold for several consecutive
// frames — useful for the "Step until rest" UX and for the e2e to count
// how many chunks have settled.
//
// Pure JS, no external dependencies. THREE.Vector3 is used only for
// math reuse — the public sim state is plain numeric arrays.

import * as THREE from 'three';

const REST_VEL_EPS = 0.005;        // m/s
const REST_POS_EPS = 0.0005;       // m / frame
const REST_FRAMES_TO_SLEEP = 30;   // frames below the eps before "sleep"

// Initialise sim state for a chunk array. Each `chunk` must expose:
//   { mesh, centroid:Vector3, bbox:Box3 (local) }
// Returns the array augmented with sim fields. Idempotent.
export function initChunkBodies(chunks, opts) {
  const o = opts || {};
  const restitution = o.restitution != null ? Number(o.restitution) : 0.4;
  const friction = o.friction != null ? Number(o.friction) : 0.85;
  for (const ch of chunks) {
    if (ch.__rbdInited) continue;
    ch.vel = [0, 0, 0];
    ch.restitution = restitution;
    ch.friction = friction;
    ch.mass = (ch.mass != null) ? Number(ch.mass) : 1;
    ch.restingFrames = 0;
    ch.asleep = false;
    ch.__rbdInited = true;
  }
  return chunks;
}

// World-space AABB of chunk = local bbox shifted by mesh world position.
// (We treat chunks as translation-only rigid bodies for simplicity; the
// authentic Houdini RBD solver supports rotation but the user-visible
// destruction effect — chunks scatter under gravity + collide — reads
// the same with translation-only and is what the e2e asserts.)
function _worldBox(ch) {
  const p = ch.mesh.position;
  return {
    minX: ch.bbox.min.x + p.x, minY: ch.bbox.min.y + p.y, minZ: ch.bbox.min.z + p.z,
    maxX: ch.bbox.max.x + p.x, maxY: ch.bbox.max.y + p.y, maxZ: ch.bbox.max.z + p.z,
  };
}

function _aabbOverlap(a, b) {
  return a.maxX > b.minX && a.minX < b.maxX
      && a.maxY > b.minY && a.minY < b.maxY
      && a.maxZ > b.minZ && a.minZ < b.maxZ;
}

// Returns { axis: 0|1|2, depth: number, sign: +1 | -1 } so caller can
// push a by sign·depth along axis. axis 0 = X, 1 = Y, 2 = Z.
function _penetrationAxis(a, b) {
  const dx1 = b.maxX - a.minX, dx2 = a.maxX - b.minX;
  const dy1 = b.maxY - a.minY, dy2 = a.maxY - b.minY;
  const dz1 = b.maxZ - a.minZ, dz2 = a.maxZ - b.minZ;
  const px = Math.min(dx1, dx2), signX = dx1 < dx2 ? -1 : 1;
  const py = Math.min(dy1, dy2), signY = dy1 < dy2 ? -1 : 1;
  const pz = Math.min(dz1, dz2), signZ = dz1 < dz2 ? -1 : 1;
  if (px <= py && px <= pz) return { axis: 0, depth: px, sign: signX };
  if (py <= pz)              return { axis: 1, depth: py, sign: signY };
  return                            { axis: 2, depth: pz, sign: signZ };
}

// One semi-implicit Euler step + bbox collision response + ground plane.
//
// `chunks`: array from initChunkBodies()
// `dt`: seconds (clamped to ≤ 0.05)
// `gravity`: [gx, gy, gz] m/s² (default [0,-9.81,0])
// `iterations`: collision relaxation iterations (default 2)
// `groundY`: ground plane Y (default 0; pass null to disable)
//
// Returns { ok, restingCount } — chunks whose velocity & motion have
// stayed below the rest threshold for REST_FRAMES_TO_SLEEP frames.
export function simulateChunks(chunks, dt, gravity, iterations, groundY) {
  if (!Array.isArray(chunks) || chunks.length === 0) {
    return { ok: true, restingCount: 0 };
  }
  const _dt = Math.min(0.05, Math.max(1e-4, Number(dt) || 1 / 60));
  const g = gravity || [0, -9.81, 0];
  const iters = Math.max(1, Math.floor(Number(iterations) || 2));
  const ground = (groundY === null) ? null
                 : (groundY != null ? Number(groundY) : 0);

  // 1. Integrate awake bodies.
  for (const ch of chunks) {
    if (ch.asleep) continue;
    const m = ch.mesh;
    if (!m) continue;
    const px0 = m.position.x, py0 = m.position.y, pz0 = m.position.z;
    ch.vel[0] += g[0] * _dt;
    ch.vel[1] += g[1] * _dt;
    ch.vel[2] += g[2] * _dt;
    m.position.x = px0 + ch.vel[0] * _dt;
    m.position.y = py0 + ch.vel[1] * _dt;
    m.position.z = pz0 + ch.vel[2] * _dt;
    ch.__lastDelta = Math.hypot(
      m.position.x - px0, m.position.y - py0, m.position.z - pz0,
    );
  }

  // 2. Ground plane (axis-aligned floor): clamp Y and bounce.
  if (ground !== null) {
    for (const ch of chunks) {
      if (ch.asleep) continue;
      const m = ch.mesh;
      if (!m) continue;
      const localFloor = ch.bbox.min.y;
      const floorYWorld = ground - localFloor;
      if (m.position.y < floorYWorld) {
        m.position.y = floorYWorld;
        if (ch.vel[1] < 0) ch.vel[1] = -ch.vel[1] * ch.restitution;
        ch.vel[0] *= ch.friction;
        ch.vel[2] *= ch.friction;
      }
    }
  }

  // 3. Pairwise AABB collision response, relaxed over `iters` iterations.
  for (let it = 0; it < iters; it++) {
    let anyCollision = false;
    for (let i = 0; i < chunks.length; i++) {
      const a = chunks[i];
      if (!a.mesh) continue;
      const ba = _worldBox(a);
      for (let j = i + 1; j < chunks.length; j++) {
        const b = chunks[j];
        if (!b.mesh) continue;
        if (a.asleep && b.asleep) continue;
        const bb = _worldBox(b);
        if (!_aabbOverlap(ba, bb)) continue;
        anyCollision = true;
        const pen = _penetrationAxis(ba, bb);
        // Push apart along penetration axis. Equal mass split.
        const half = pen.depth * 0.5;
        const axisKey = (pen.axis === 0) ? 'x' : (pen.axis === 1) ? 'y' : 'z';
        if (!a.asleep) a.mesh.position[axisKey] += pen.sign * half;
        if (!b.asleep) b.mesh.position[axisKey] -= pen.sign * half;

        // Reflect velocities along the penetration axis with the
        // average restitution. A positional-correction collision
        // model: only the velocity component normal to the contact
        // gets reflected, the tangential component is friction-damped.
        const r = (a.restitution + b.restitution) * 0.5;
        const vAxisA = a.vel[pen.axis];
        const vAxisB = b.vel[pen.axis];
        // Bounce.
        const vAxisAfterA = -vAxisA * r;
        const vAxisAfterB = -vAxisB * r;
        if (!a.asleep) a.vel[pen.axis] = vAxisAfterA;
        if (!b.asleep) b.vel[pen.axis] = vAxisAfterB;
        // Tangential damping.
        const fr = ((a.friction + b.friction) * 0.5);
        for (let k = 0; k < 3; k++) {
          if (k === pen.axis) continue;
          if (!a.asleep) a.vel[k] *= fr;
          if (!b.asleep) b.vel[k] *= fr;
        }
        // Wake on contact.
        a.asleep = false;
        b.asleep = false;
      }
    }
    if (!anyCollision) break;
  }

  // 4. Sleep/rest detection. Count chunks whose velocity and per-frame
  // motion have been below the threshold for REST_FRAMES_TO_SLEEP frames.
  let resting = 0;
  for (const ch of chunks) {
    const vMag = Math.hypot(ch.vel[0], ch.vel[1], ch.vel[2]);
    const delta = ch.__lastDelta || 0;
    if (vMag < REST_VEL_EPS && delta < REST_POS_EPS) {
      ch.restingFrames++;
      if (ch.restingFrames >= REST_FRAMES_TO_SLEEP) {
        ch.asleep = true;
        ch.vel[0] = ch.vel[1] = ch.vel[2] = 0;
      }
    } else {
      ch.restingFrames = 0;
      ch.asleep = false;
    }
    if (ch.asleep) resting++;
  }

  return { ok: true, restingCount: resting };
}

// Apply an outward impulse from `origin` to every chunk. Magnitude
// scales with `1 / max(distance, eps)` so close chunks receive more
// kick, mirroring the Houdini "explode_radial" force operator.
//
// Returns { ok, awakeCount } — chunks woken by the impulse.
export function applyExplodeImpulse(chunks, origin, impulseScale) {
  if (!Array.isArray(chunks)) return { ok: false };
  const o = origin || new THREE.Vector3(0, 0, 0);
  const k = Number(impulseScale) || 1;
  let woke = 0;
  for (const ch of chunks) {
    const cWorld = new THREE.Vector3(
      ch.centroid.x + (ch.mesh ? ch.mesh.position.x : 0),
      ch.centroid.y + (ch.mesh ? ch.mesh.position.y : 0),
      ch.centroid.z + (ch.mesh ? ch.mesh.position.z : 0),
    );
    const dx = cWorld.x - o.x;
    const dy = cWorld.y - o.y;
    const dz = cWorld.z - o.z;
    const d  = Math.hypot(dx, dy, dz) || 1e-3;
    const mag = k / d;
    ch.vel[0] += (dx / d) * mag / Math.max(1e-3, ch.mass);
    ch.vel[1] += (dy / d) * mag / Math.max(1e-3, ch.mass);
    ch.vel[2] += (dz / d) * mag / Math.max(1e-3, ch.mass);
    ch.asleep = false;
    ch.restingFrames = 0;
    woke++;
  }
  return { ok: true, awakeCount: woke };
}
