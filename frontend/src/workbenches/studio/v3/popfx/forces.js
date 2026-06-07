// ArchDisc Studio V3 — Houdini POP force functions (slice 777).
//
// Houdini's `popforce`, `popwind`, `popcurveforce`, `popcurlnoise`, and
// `popattract` DOPs all share a common signature: given a particle and a
// timestep, mutate `particle.velocity` in place. This module is the
// canonical implementation of the six headline forces every POP graph
// reaches for (the slice-727 `houdinipop` chain shipped four basic ops;
// this slice ships the *full* force set the real Houdini POP solver
// exposes, plus the divergence-free curl noise + vortex flow primitive
// that are missing without an analytic noise field).
//
// All forces follow the convention:
//
//   force(particle, ...params, dt)
//
// where `particle = { position: [x,y,z], velocity: [vx,vy,vz], … }`
// and the trailing `dt` is the integration step. Each function applies
//
//   v += a · dt
//
// where `a` is the per-frame acceleration the force contributes. The
// solver in `popSolver.js` calls them once per particle per step in the
// order they were added.
//
// Determinism: every noise lookup goes through `common/noise.js`'s
// `smoothValueNoise3D` (integer-lattice trilinear-interpolated lattice
// hash — NEVER `Math.random`). The `time` parameter is the simulation
// elapsed time, fed into the noise as an extra dimension so the field
// evolves over time without leaking RNG entropy.
//
// Pure JS, no new deps.

import { smoothValueNoise3D } from '../common/noise.js';

// ─── Gravity ──────────────────────────────────────────────────────────
// Adds a uniform downward (or arbitrary-direction) acceleration. The
// `g` argument is either a scalar (treated as `[0, -g, 0]`) or a 3-tuple
// `[gx, gy, gz]`. Default gravity is Earth's 9.81 m/s² straight down.
export function gravityForce(particle, g, dt) {
  if (!particle || !particle.velocity) return;
  const step = +dt || 0;
  let gx, gy, gz;
  if (Array.isArray(g)) {
    gx = +g[0] || 0;
    gy = +g[1] || 0;
    gz = +g[2] || 0;
  } else if (Number.isFinite(+g)) {
    gx = 0;
    gy = -(+g);
    gz = 0;
  } else {
    gx = 0;
    gy = -9.81;
    gz = 0;
  }
  particle.velocity[0] += gx * step;
  particle.velocity[1] += gy * step;
  particle.velocity[2] += gz * step;
}

// ─── Uniform wind ─────────────────────────────────────────────────────
// Adds a uniform acceleration along `dir` scaled by `strength`. `dir`
// is normalised inside the function so callers can pass any non-zero
// vector; a zero `dir` is a silent no-op. The acceleration model is
// `a = dir̂ · strength` (constant over the timestep).
export function windForce(particle, dir, strength, dt) {
  if (!particle || !particle.velocity) return;
  if (!Array.isArray(dir) || dir.length < 3) return;
  const step = +dt || 0;
  const s = +strength || 0;
  if (s === 0) return;
  const dx = +dir[0] || 0;
  const dy = +dir[1] || 0;
  const dz = +dir[2] || 0;
  const mag = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (mag < 1e-9) return;
  const inv = 1 / mag;
  particle.velocity[0] += dx * inv * s * step;
  particle.velocity[1] += dy * inv * s * step;
  particle.velocity[2] += dz * inv * s * step;
}

// ─── Turbulence (3-channel value noise wind) ───────────────────────────
// Samples the deterministic lattice noise at three independent seeds and
// uses the (n_x, n_y, n_z) triple as the local wind direction at this
// particle's position. `scale` is the spatial frequency (smaller =
// larger eddies); `strength` is the acceleration magnitude. `time` is
// folded in as an extra noise dimension so the field flows over time.
//
// Honest scope: this is value-noise turbulence (Houdini `popforce` with a
// VOP-driven `aanoise` field), not full Perlin gradient noise — but the
// trilinearly-interpolated lattice hash is smooth enough for visible
// swirls and never produces grid-aligned artefacts on physical scales.
export function turbulenceForce(particle, scale, strength, time, dt) {
  if (!particle || !particle.velocity || !particle.position) return;
  const step = +dt || 0;
  const sc = +scale > 0 ? +scale : 1;
  const s = +strength || 0;
  if (s === 0) return;
  const t = +time || 0;
  const x = particle.position[0] * sc;
  const y = particle.position[1] * sc;
  const z = particle.position[2] * sc;
  // Three independent noise channels with different seeds → vector field.
  const nx = smoothValueNoise3D(x + t, y, z, 1);
  const ny = smoothValueNoise3D(x, y + t, z, 2);
  const nz = smoothValueNoise3D(x, y, z + t, 3);
  particle.velocity[0] += nx * s * step;
  particle.velocity[1] += ny * s * step;
  particle.velocity[2] += nz * s * step;
}

// ─── Curl-noise (divergence-free turbulence) ───────────────────────────
// Builds a divergence-free vector field from a scalar potential P by
// computing curl(P) = (∂Pz/∂y − ∂Py/∂z, ∂Px/∂z − ∂Pz/∂x, ∂Py/∂x − ∂Px/∂y)
// where Px, Py, Pz are three independent scalar noise fields. The result
// is *incompressible*: particles flow along it without piling up at
// noise extrema, the classic Bridson 2007 "Curl Noise for Procedural
// Fluid Flow" recipe Houdini's `popcurlnoise` uses.
//
// Honest scope: we approximate the gradients by central differences on a
// fixed epsilon (1e-3 in noise-space units). Bridson's analytic-gradient
// formulation is preferable but requires a noise function whose
// derivative is in closed form; the lattice hash here doesn't have one,
// and central diffs match the standard reference implementation.
export function curlNoiseForce(particle, scale, strength, time, dt) {
  if (!particle || !particle.velocity || !particle.position) return;
  const step = +dt || 0;
  const sc = +scale > 0 ? +scale : 1;
  const s = +strength || 0;
  if (s === 0) return;
  const t = +time || 0;
  const eps = 1e-3;
  const x = particle.position[0] * sc;
  const y = particle.position[1] * sc;
  const z = particle.position[2] * sc;
  // Three potential fields, each with its own seed.
  const Px = (xx, yy, zz) => smoothValueNoise3D(xx, yy + t, zz, 11);
  const Py = (xx, yy, zz) => smoothValueNoise3D(xx + t, yy, zz, 13);
  const Pz = (xx, yy, zz) => smoothValueNoise3D(xx, yy, zz + t, 17);
  const dPz_dy = (Pz(x, y + eps, z) - Pz(x, y - eps, z)) / (2 * eps);
  const dPy_dz = (Py(x, y, z + eps) - Py(x, y, z - eps)) / (2 * eps);
  const dPx_dz = (Px(x, y, z + eps) - Px(x, y, z - eps)) / (2 * eps);
  const dPz_dx = (Pz(x + eps, y, z) - Pz(x - eps, y, z)) / (2 * eps);
  const dPy_dx = (Py(x + eps, y, z) - Py(x - eps, y, z)) / (2 * eps);
  const dPx_dy = (Px(x, y + eps, z) - Px(x, y - eps, z)) / (2 * eps);
  // Curl of the potential vector field.
  const cx = dPz_dy - dPy_dz;
  const cy = dPx_dz - dPz_dx;
  const cz = dPy_dx - dPx_dy;
  particle.velocity[0] += cx * s * step;
  particle.velocity[1] += cy * s * step;
  particle.velocity[2] += cz * s * step;
}

// ─── Vortex (swirling flow around an axis) ─────────────────────────────
// Models a Rankine vortex centred at `center` with rotation axis `axis`
// (normalised inside) and angular strength `strength`. The velocity
// contribution is `a = strength · (axis × r)` where `r` is the vector
// from the centre to the particle — the particle gets tangential
// acceleration whose direction is right-hand-rule around the axis and
// whose magnitude grows linearly with distance from the axis (real
// solid-body rotation core). For a Houdini-style decay outside the core
// the caller can taper strength via the SolverConfig.
export function vortexForce(particle, center, axis, strength, dt) {
  if (!particle || !particle.velocity || !particle.position) return;
  if (!Array.isArray(center) || center.length < 3) return;
  if (!Array.isArray(axis) || axis.length < 3) return;
  const step = +dt || 0;
  const s = +strength || 0;
  if (s === 0) return;
  const rx = particle.position[0] - (+center[0] || 0);
  const ry = particle.position[1] - (+center[1] || 0);
  const rz = particle.position[2] - (+center[2] || 0);
  let ax = +axis[0] || 0;
  let ay = +axis[1] || 0;
  let az = +axis[2] || 0;
  const amag = Math.sqrt(ax * ax + ay * ay + az * az);
  if (amag < 1e-9) return;
  const inv = 1 / amag;
  ax *= inv; ay *= inv; az *= inv;
  // a = axis × r (right-handed)
  const tx = ay * rz - az * ry;
  const ty = az * rx - ax * rz;
  const tz = ax * ry - ay * rx;
  particle.velocity[0] += tx * s * step;
  particle.velocity[1] += ty * s * step;
  particle.velocity[2] += tz * s * step;
}

// ─── Attractor (point-mass pull) ───────────────────────────────────────
// Adds an acceleration toward `center` with magnitude `strength` falling
// off as `1 / (1 + (d/distance)²)` where `d` is the actual distance and
// `distance` is the falloff scale. The pull never blows up at d=0 (the
// `1 +` floor prevents division-by-zero singularities and matches the
// Houdini `popattract` smoothed-distance fall-off knob).
//
// Pass a negative `strength` for a repulsor.
export function attractorForce(particle, center, strength, distance, dt) {
  if (!particle || !particle.velocity || !particle.position) return;
  if (!Array.isArray(center) || center.length < 3) return;
  const step = +dt || 0;
  const s = +strength || 0;
  if (s === 0) return;
  const d0 = +distance > 0 ? +distance : 1;
  const dx = (+center[0] || 0) - particle.position[0];
  const dy = (+center[1] || 0) - particle.position[1];
  const dz = (+center[2] || 0) - particle.position[2];
  const d2 = dx * dx + dy * dy + dz * dz;
  const d = Math.sqrt(d2);
  if (d < 1e-9) return;
  const inv = 1 / d;
  const nx = dx * inv, ny = dy * inv, nz = dz * inv;
  // Smoothed inverse-square fall-off so a particle at the centre doesn't
  // get an infinite kick.
  const falloff = 1 / (1 + (d / d0) * (d / d0));
  const k = s * falloff;
  particle.velocity[0] += nx * k * step;
  particle.velocity[1] += ny * k * step;
  particle.velocity[2] += nz * k * step;
}

// ─── Force-kind dispatcher ─────────────────────────────────────────────
// Convenience helper used by the solver when iterating an op stack.
// `kind` is one of the six tags below; `params` is the function-specific
// parameter bag. Unknown kinds are silent no-ops so a misconfigured op
// graph doesn't throw mid-step (Houdini POP nodes degrade gracefully
// when a parameter is missing).
export function applyForce(particle, kind, params, time, dt) {
  if (!kind || !particle) return;
  const p = params || {};
  switch (kind) {
    case 'gravity':
      gravityForce(particle, p.g != null ? p.g : (p.direction != null ? p.direction : 9.81), dt);
      return;
    case 'wind':
      windForce(particle, p.direction || p.dir || [1, 0, 0], p.strength != null ? p.strength : 1, dt);
      return;
    case 'turbulence':
      turbulenceForce(particle,
        p.scale != null ? p.scale : 0.5,
        p.strength != null ? p.strength : 1,
        time, dt);
      return;
    case 'curl':
    case 'curlnoise':
      curlNoiseForce(particle,
        p.scale != null ? p.scale : 0.5,
        p.strength != null ? p.strength : 1,
        time, dt);
      return;
    case 'vortex':
      vortexForce(particle,
        p.center || [0, 0, 0],
        p.axis || [0, 1, 0],
        p.strength != null ? p.strength : 1,
        dt);
      return;
    case 'attractor':
      attractorForce(particle,
        p.center || [0, 0, 0],
        p.strength != null ? p.strength : 1,
        p.distance != null ? p.distance : 1,
        dt);
      return;
    default:
      // Unknown force kind — silent no-op.
      return;
  }
}

// Canonical list of force kinds for UI surfaces / autocompletion.
export const FORCE_KINDS = Object.freeze([
  'gravity', 'wind', 'turbulence', 'curl', 'vortex', 'attractor',
]);
