// ArchDisc Studio V3 — FX force fields.
//
// A force field is a region of space that applies an extra body force to
// every particle (slice-632 __studioCreateParticleSystem) and every hair
// strand vertex (fx/hair.js) every frame. Blender's particle stack has
// "force fields" that come in flavours — Force, Vortex, Drag, etc. — and
// we ship the four with the highest perceptual impact for a small CPU
// budget:
//
//   • attract { pos:[x,y,z], strength, radius }  — Newtonian pull toward
//                                                   pos, falloff = 1/r²
//                                                   clamped to radius.
//   • repel   { pos, strength, radius }          — same magnitude, sign-
//                                                   inverted (point pushes
//                                                   particles away).
//   • vortex  { axis:[x,y,z], pos, strength }    — swirl about the axis
//                                                   through pos. Force is
//                                                   axis × (p - pos)
//                                                   scaled by strength,
//                                                   producing tangential
//                                                   motion.
//   • drag    { coefficient }                    — velocity damping
//                                                   (Stokes' law). Force
//                                                   = -coef · v. Acts
//                                                   uniformly across the
//                                                   scene (no radius).
//
// Forces live in a module-level array `_forces`. Both particle systems
// and hair pull this list each tick via `applyForces(px, py, pz, vx, vy,
// vz, accum)` which mutates the accumulator in place — zero per-call
// allocation. Each entry carries a uuid (cheap counter) so the user can
// remove it later.
//
// Public op surface (wrapped + registered by fx/index.js):
//   addForce(kind, params) → { ok, uuid }
//   removeForce(uuid)      → { ok, removed }
//   listForces()           → { ok, forces:[…] }
//   clearForces()          → { ok, removed:n }
//   applyForces(px,py,pz,vx,vy,vz,accum) — used internally by hair &
//                                          the particle augment tick.

let _uuidCounter = 0;
function _newUuid() {
  _uuidCounter += 1;
  return `fxforce-${_uuidCounter.toString(36)}`;
}

// Each force is normalised at registration so the hot inner loop never
// has to defensively coerce inputs.
//
// Normalised entry shape:
//   { uuid, kind, px, py, pz, ax, ay, az, strength, radius, radius2, coef }
//
// Unused fields per kind are simply ignored.
const _forces = [];

function _vec3Param(p, dflt) {
  if (Array.isArray(p) && p.length === 3) {
    return [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0];
  }
  if (p && typeof p === 'object' && 'x' in p) {
    return [Number(p.x) || 0, Number(p.y) || 0, Number(p.z) || 0];
  }
  return dflt.slice();
}

export function addForce(kind, params) {
  const k = String(kind || '').toLowerCase();
  const p = params || {};
  let entry = null;
  if (k === 'attract' || k === 'repel') {
    const pos = _vec3Param(p.pos, [0, 0, 0]);
    const strength = Number(p.strength);
    const radius = Math.max(1e-3, Number(p.radius) || 1);
    entry = {
      uuid: _newUuid(),
      kind: k,
      px: pos[0], py: pos[1], pz: pos[2],
      ax: 0, ay: 0, az: 0,
      strength: Number.isFinite(strength) ? strength : 1,
      radius,
      radius2: radius * radius,
      coef: 0,
    };
  } else if (k === 'vortex') {
    const pos = _vec3Param(p.pos, [0, 0, 0]);
    const axisRaw = _vec3Param(p.axis, [0, 1, 0]);
    const len = Math.hypot(axisRaw[0], axisRaw[1], axisRaw[2]) || 1;
    const strength = Number(p.strength);
    entry = {
      uuid: _newUuid(),
      kind: 'vortex',
      px: pos[0], py: pos[1], pz: pos[2],
      ax: axisRaw[0] / len, ay: axisRaw[1] / len, az: axisRaw[2] / len,
      strength: Number.isFinite(strength) ? strength : 1,
      radius: 0,
      radius2: 0,
      coef: 0,
    };
  } else if (k === 'drag') {
    const coef = Number(p.coefficient);
    entry = {
      uuid: _newUuid(),
      kind: 'drag',
      px: 0, py: 0, pz: 0,
      ax: 0, ay: 0, az: 0,
      strength: 0,
      radius: 0,
      radius2: 0,
      coef: Number.isFinite(coef) ? coef : 0.5,
    };
  } else {
    return { ok: false, error: `unknown force kind '${kind}'` };
  }
  _forces.push(entry);
  return { ok: true, uuid: entry.uuid };
}

export function removeForce(uuid) {
  const i = _forces.findIndex((f) => f.uuid === uuid);
  if (i < 0) return { ok: false, error: 'no force' };
  _forces.splice(i, 1);
  return { ok: true, removed: uuid };
}

export function listForces() {
  return {
    ok: true,
    forces: _forces.map((f) => {
      const out = { uuid: f.uuid, kind: f.kind };
      if (f.kind === 'attract' || f.kind === 'repel') {
        out.pos = [f.px, f.py, f.pz];
        out.strength = f.strength;
        out.radius = f.radius;
      } else if (f.kind === 'vortex') {
        out.pos = [f.px, f.py, f.pz];
        out.axis = [f.ax, f.ay, f.az];
        out.strength = f.strength;
      } else if (f.kind === 'drag') {
        out.coefficient = f.coef;
      }
      return out;
    }),
  };
}

export function clearForces() {
  const n = _forces.length;
  _forces.length = 0;
  return { ok: true, removed: n };
}

// applyForces — hot inner-loop helper. Adds the force vector for every
// registered force at the world-space sample (px, py, pz, vx, vy, vz)
// into accum (a length-3 array reused by the caller). Returns accum so
// the call site reads naturally.
//
//   const accum = [0,0,0];
//   applyForces(px, py, pz, vx, vy, vz, accum);
//   particle.ax += accum[0]; particle.ay += accum[1]; particle.az += accum[2];
//
// Caller decides whether the force adds to acceleration (typical for
// particles where mass = 1) or to velocity directly.
export function applyForces(px, py, pz, vx, vy, vz, accum) {
  accum[0] = 0; accum[1] = 0; accum[2] = 0;
  for (let i = 0; i < _forces.length; i++) {
    const f = _forces[i];
    if (f.kind === 'attract' || f.kind === 'repel') {
      const dx = f.px - px, dy = f.py - py, dz = f.pz - pz;
      const r2 = dx * dx + dy * dy + dz * dz;
      if (r2 > f.radius2 || r2 < 1e-8) continue;
      // 1/(r² + ε) falloff, clamped. Sign: attract pulls toward (dx,dy,dz),
      // repel pushes away (negate).
      const inv = 1.0 / (r2 + 0.01);
      const r = Math.sqrt(r2);
      const s = f.strength * inv;
      const sx = (dx / r) * s, sy = (dy / r) * s, sz = (dz / r) * s;
      if (f.kind === 'attract') {
        accum[0] += sx; accum[1] += sy; accum[2] += sz;
      } else {
        accum[0] -= sx; accum[1] -= sy; accum[2] -= sz;
      }
    } else if (f.kind === 'vortex') {
      // Tangential swirl: axis × (p - pos), scaled.
      const rx = px - f.px, ry = py - f.py, rz = pz - f.pz;
      // axis × r (right-hand cross product).
      const cx = f.ay * rz - f.az * ry;
      const cy = f.az * rx - f.ax * rz;
      const cz = f.ax * ry - f.ay * rx;
      accum[0] += cx * f.strength;
      accum[1] += cy * f.strength;
      accum[2] += cz * f.strength;
    } else if (f.kind === 'drag') {
      // Stokes drag — force opposes velocity.
      accum[0] -= vx * f.coef;
      accum[1] -= vy * f.coef;
      accum[2] -= vz * f.coef;
    }
  }
  return accum;
}

export function _forceCount() {
  return _forces.length;
}
