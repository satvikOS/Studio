// Slice 730 — Gas / Pyro simulation (Houdini Pyro FX, Blender Mantaflow
// smoke, FumeFX, EmberGen). Eulerian grid fluid solver layered on top of
// the slice-698 volume grid (Data3DTexture R=density, G=temperature).
//
// Algorithm — Jos Stam's "Stable Fluids" (SIGGRAPH 1999) extended to 3D,
// the same semi-Lagrangian advect + Gauss-Seidel pressure-projection
// scheme every production smoke solver descends from:
//
//   velocity step:
//     1. buoyancy   — hot cells rise (temperature * α up), dense smoke
//                     sinks (density * β down)  [Foster & Metaxas force]
//     2. vorticity confinement — re-inject the small-scale curl that
//                     numerical diffusion smears away (Fedkiw et al. 2001),
//                     giving the characteristic rolling/billowing motion
//     3. project    — make the field divergence-free (mass-conserving)
//                     by solving ∇²p = ∇·u and subtracting ∇p
//     4. advect     — back-trace each velocity component along the flow
//     5. project    — re-project after advection
//   scalar step:
//     6. advect density + temperature along the (divergence-free) velocity
//     7. dissipate  — density fades (smoke dissipates), temperature cools
//
// Velocities are in GRID-CELL units per second so the back-trace is
// dimension-independent (works on non-cubic grids). The solver keeps its
// own Float32 fields; after each step density+temperature are quantised
// back into the volume's Uint8 RGBA buffer so the existing raymarch proxy
// (proxy.js / shader.frag.js) renders the live sim with zero shader work.
//
// Pure JS, deterministic, eval-free. Bounded cost: O(cells · iters).

import { getVolume } from './grid.js';

// Per-volume simulation state, keyed by the volume uuid.
const _sims = new Map();

// Cap the simulated grid so a runaway op can't lock the main thread.
const MAX_SIM_CELLS = 96 * 96 * 96;

function _f32(n) { return new Float32Array(n); }

// Allocate (or fetch) the float simulation fields for a volume.
function _ensureSim(uuid) {
  let sim = _sims.get(uuid);
  if (sim) return sim;
  const v = getVolume(uuid);
  if (!v) return null;
  const n = v.sx * v.sy * v.sz;
  if (n > MAX_SIM_CELLS) return null;
  sim = {
    uuid, sx: v.sx, sy: v.sy, sz: v.sz, n,
    vx: _f32(n), vy: _f32(n), vz: _f32(n),
    vx0: _f32(n), vy0: _f32(n), vz0: _f32(n),
    dens: _f32(n), dens0: _f32(n),
    temp: _f32(n), temp0: _f32(n),
    p: _f32(n), div: _f32(n), curl: _f32(n),
    emitters: [],
    frame: 0,
    // Tunables (Houdini Pyro shelf defaults, scaled to cell units).
    params: {
      buoyancy: 6.0,      // upward force per unit temperature
      weight: 0.5,        // downward force per unit density (smoke mass)
      vorticity: 4.0,     // vorticity-confinement strength (ε)
      dissipation: 0.04,  // density fade per second
      cooling: 0.6,       // temperature cooling per second
      iters: 12,          // Gauss-Seidel projection iterations
    },
  };
  _sims.set(uuid, sim);
  return sim;
}

const IX = (s, x, y, z) => x + y * s.sx + z * s.sx * s.sy;

// ── Boundary conditions ─────────────────────────────────────────────
// b: 0 = scalar (copy), 1 = vx, 2 = vy, 3 = vz (negate the normal
// component so the field reflects off the wall — a solid container).
function setBnd(s, b, f) {
  const { sx, sy, sz } = s;
  // X faces
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) {
    f[IX(s, 0, y, z)]      = b === 1 ? -f[IX(s, 1, y, z)]      : f[IX(s, 1, y, z)];
    f[IX(s, sx - 1, y, z)] = b === 1 ? -f[IX(s, sx - 2, y, z)] : f[IX(s, sx - 2, y, z)];
  }
  // Y faces
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) {
    f[IX(s, x, 0, z)]      = b === 2 ? -f[IX(s, x, 1, z)]      : f[IX(s, x, 1, z)];
    f[IX(s, x, sy - 1, z)] = b === 2 ? -f[IX(s, x, sy - 2, z)] : f[IX(s, x, sy - 2, z)];
  }
  // Z faces
  for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    f[IX(s, x, y, 0)]      = b === 3 ? -f[IX(s, x, y, 1)]      : f[IX(s, x, y, 1)];
    f[IX(s, x, y, sz - 1)] = b === 3 ? -f[IX(s, x, y, sz - 2)] : f[IX(s, x, y, sz - 2)];
  }
}

// Gauss-Seidel relaxation for the linear system (∇²-style stencil).
function linSolve(s, b, x, x0, a, c, iters) {
  const cRecip = 1.0 / c;
  const { sx, sy, sz } = s;
  for (let k = 0; k < iters; k++) {
    for (let z = 1; z < sz - 1; z++)
      for (let y = 1; y < sy - 1; y++)
        for (let xi = 1; xi < sx - 1; xi++) {
          const i = IX(s, xi, y, z);
          x[i] = (x0[i] + a * (
            x[i - 1] + x[i + 1] +
            x[i - sx] + x[i + sx] +
            x[i - sx * sy] + x[i + sx * sy]
          )) * cRecip;
        }
    setBnd(s, b, x);
  }
}

// Make the velocity field divergence-free (project out the gradient part).
function project(s) {
  const { sx, sy, sz, vx, vy, vz, p, div } = s;
  for (let z = 1; z < sz - 1; z++)
    for (let y = 1; y < sy - 1; y++)
      for (let xi = 1; xi < sx - 1; xi++) {
        const i = IX(s, xi, y, z);
        div[i] = -0.5 * (
          vx[i + 1] - vx[i - 1] +
          vy[i + sx] - vy[i - sx] +
          vz[i + sx * sy] - vz[i - sx * sy]
        );
        p[i] = 0;
      }
  setBnd(s, 0, div);
  setBnd(s, 0, p);
  linSolve(s, 0, p, div, 1, 6, s.params.iters);
  for (let z = 1; z < sz - 1; z++)
    for (let y = 1; y < sy - 1; y++)
      for (let xi = 1; xi < sx - 1; xi++) {
        const i = IX(s, xi, y, z);
        vx[i] -= 0.5 * (p[i + 1] - p[i - 1]);
        vy[i] -= 0.5 * (p[i + sx] - p[i - sx]);
        vz[i] -= 0.5 * (p[i + sx * sy] - p[i - sx * sy]);
      }
  setBnd(s, 1, vx);
  setBnd(s, 2, vy);
  setBnd(s, 3, vz);
}

// Semi-Lagrangian advection: back-trace each cell along the velocity field
// and trilinearly sample the previous field.
function advect(s, b, d, d0, vx, vy, vz, dt) {
  const { sx, sy, sz } = s;
  for (let z = 1; z < sz - 1; z++)
    for (let y = 1; y < sy - 1; y++)
      for (let xi = 1; xi < sx - 1; xi++) {
        const i = IX(s, xi, y, z);
        let fx = xi - dt * vx[i];
        let fy = y - dt * vy[i];
        let fz = z - dt * vz[i];
        if (fx < 0.5) fx = 0.5; if (fx > sx - 1.5) fx = sx - 1.5;
        if (fy < 0.5) fy = 0.5; if (fy > sy - 1.5) fy = sy - 1.5;
        if (fz < 0.5) fz = 0.5; if (fz > sz - 1.5) fz = sz - 1.5;
        const i0 = Math.floor(fx), i1 = i0 + 1;
        const j0 = Math.floor(fy), j1 = j0 + 1;
        const k0 = Math.floor(fz), k1 = k0 + 1;
        const sx1 = fx - i0, sx0 = 1 - sx1;
        const sy1 = fy - j0, sy0 = 1 - sy1;
        const sz1 = fz - k0, sz0 = 1 - sz1;
        d[i] =
          sz0 * (
            sy0 * (sx0 * d0[IX(s, i0, j0, k0)] + sx1 * d0[IX(s, i1, j0, k0)]) +
            sy1 * (sx0 * d0[IX(s, i0, j1, k0)] + sx1 * d0[IX(s, i1, j1, k0)])
          ) +
          sz1 * (
            sy0 * (sx0 * d0[IX(s, i0, j0, k1)] + sx1 * d0[IX(s, i1, j0, k1)]) +
            sy1 * (sx0 * d0[IX(s, i0, j1, k1)] + sx1 * d0[IX(s, i1, j1, k1)])
          );
      }
  setBnd(s, b, d);
}

// Vorticity confinement — restore small-scale rotational detail lost to
// numerical diffusion (Fedkiw, Stam, Jensen 2001).
function vorticityConfinement(s, dt) {
  const { sx, sy, sz, vx, vy, vz, curl } = s;
  const eps = s.params.vorticity;
  if (eps <= 0) return;
  // |ω| magnitude per cell into curl[].
  for (let z = 1; z < sz - 1; z++)
    for (let y = 1; y < sy - 1; y++)
      for (let xi = 1; xi < sx - 1; xi++) {
        const i = IX(s, xi, y, z);
        const wx = (vz[i + sx] - vz[i - sx]) - (vy[i + sx * sy] - vy[i - sx * sy]);
        const wy = (vx[i + sx * sy] - vx[i - sx * sy]) - (vz[i + 1] - vz[i - 1]);
        const wz = (vy[i + 1] - vy[i - 1]) - (vx[i + sx] - vx[i - sx]);
        curl[i] = 0.5 * Math.sqrt(wx * wx + wy * wy + wz * wz);
      }
  for (let z = 1; z < sz - 1; z++)
    for (let y = 1; y < sy - 1; y++)
      for (let xi = 1; xi < sx - 1; xi++) {
        const i = IX(s, xi, y, z);
        // Gradient of |ω| (the location-vector N).
        let nx = (curl[i + 1] - curl[i - 1]) * 0.5;
        let ny = (curl[i + sx] - curl[i - sx]) * 0.5;
        let nz = (curl[i + sx * sy] - curl[i - sx * sy]) * 0.5;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) + 1e-6;
        nx /= len; ny /= len; nz /= len;
        // ω vector again (needed for N × ω).
        const wx = (vz[i + sx] - vz[i - sx]) - (vy[i + sx * sy] - vy[i - sx * sy]);
        const wy = (vx[i + sx * sy] - vx[i - sx * sy]) - (vz[i + 1] - vz[i - 1]);
        const wz = (vy[i + 1] - vy[i - 1]) - (vx[i + sx] - vx[i - sx]);
        vx[i] += eps * dt * (ny * wz - nz * wy);
        vy[i] += eps * dt * (nz * wx - nx * wz);
        vz[i] += eps * dt * (nx * wy - ny * wx);
      }
}

// Buoyancy — hot cells rise, smoke mass pulls down (gravity along +Y up).
function buoyancy(s, dt) {
  const { n, vy, temp, dens } = s;
  const { buoyancy: a, weight: w } = s.params;
  for (let i = 0; i < n; i++) {
    vy[i] += dt * (a * temp[i] - w * dens[i]);
  }
}

// Inject all registered emitters into the density / temperature / velocity
// fields. An emitter is a sphere of source density + heat + upward push.
function applyEmitters(s, dt) {
  const { sx, sy, sz } = s;
  for (const e of s.emitters) {
    const cx = e.x, cy = e.y, cz = e.z, r = e.radius;
    const r2 = r * r;
    const x0 = Math.max(1, Math.floor(cx - r)), x1 = Math.min(sx - 2, Math.ceil(cx + r));
    const y0 = Math.max(1, Math.floor(cy - r)), y1 = Math.min(sy - 2, Math.ceil(cy + r));
    const z0 = Math.max(1, Math.floor(cz - r)), z1 = Math.min(sz - 2, Math.ceil(cz + r));
    for (let z = z0; z <= z1; z++)
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const dx = x - cx, dy = y - cy, dz = z - cz;
          const dist2 = dx * dx + dy * dy + dz * dz;
          if (dist2 > r2) continue;
          const fall = 1 - Math.sqrt(dist2) / r; // 1 at centre → 0 at rim
          const i = IX(s, x, y, z);
          s.dens[i] = Math.min(2.0, s.dens[i] + e.density * fall * dt);
          s.temp[i] = Math.min(2.0, Math.max(s.temp[i], e.temperature * fall));
          s.vy[i] += e.velocity * fall * dt;
        }
  }
}

// Write the float density+temperature fields back into the volume's Uint8
// RGBA buffer (R=density, G=temperature) and flag the texture dirty so the
// raymarch proxy re-renders.
function writeBack(s) {
  const v = getVolume(s.uuid);
  if (!v) return;
  const data = v.data;
  const { n, dens, temp } = s;
  for (let i = 0; i < n; i++) {
    const di = i * 4;
    let d = dens[i]; if (d < 0) d = 0; if (d > 1) d = 1;
    let t = temp[i]; if (t < 0) t = 0; if (t > 1) t = 1;
    data[di]     = (d * 255) | 0;
    data[di + 1] = (t * 255) | 0;
    data[di + 2] = 0;
    data[di + 3] = 255;
  }
  if (v.tex) v.tex.needsUpdate = true;
}

// ── Public ops ──────────────────────────────────────────────────────

export function initPyro(uuid) {
  const sim = _ensureSim(uuid);
  if (!sim) return { ok: false, error: 'volume not found or too large for sim' };
  return { ok: true, uuid, sx: sim.sx, sy: sim.sy, sz: sim.sz, cells: sim.n };
}

export function addEmitter(uuid, x, y, z, radius, density, temperature, velocity) {
  const sim = _ensureSim(uuid);
  if (!sim) return { ok: false, error: 'no sim' };
  const e = {
    x: Number(x) || sim.sx / 2,
    y: Number.isFinite(y) ? Number(y) : sim.sy * 0.18,
    z: Number(z) || sim.sz / 2,
    radius: Math.max(1, Number(radius) || Math.max(2, sim.sx * 0.12)),
    density: Number.isFinite(density) ? Number(density) : 4.0,
    temperature: Number.isFinite(temperature) ? Number(temperature) : 1.0,
    velocity: Number.isFinite(velocity) ? Number(velocity) : 8.0,
  };
  sim.emitters.push(e);
  return { ok: true, count: sim.emitters.length, emitter: e };
}

export function clearEmitters(uuid) {
  const sim = _sims.get(uuid);
  if (!sim) return { ok: false };
  sim.emitters.length = 0;
  return { ok: true };
}

export function setPyroParam(uuid, key, value) {
  const sim = _ensureSim(uuid);
  if (!sim) return { ok: false };
  if (!(key in sim.params)) return { ok: false, error: `unknown param "${key}"` };
  sim.params[key] = Number(value);
  return { ok: true, key, value: sim.params[key] };
}

// Advance the simulation by `steps` sub-steps of `dt` seconds each.
export function stepPyro(uuid, dt, steps) {
  const sim = _ensureSim(uuid);
  if (!sim) return { ok: false, error: 'no sim' };
  const h = Number(dt) || 0.1;
  const ns = Math.max(1, Math.min(60, Math.floor(steps) || 1));
  for (let it = 0; it < ns; it++) {
    applyEmitters(sim, h);
    // velocity step
    buoyancy(sim, h);
    vorticityConfinement(sim, h);
    project(sim);
    sim.vx0.set(sim.vx); sim.vy0.set(sim.vy); sim.vz0.set(sim.vz);
    advect(sim, 1, sim.vx, sim.vx0, sim.vx0, sim.vy0, sim.vz0, h);
    advect(sim, 2, sim.vy, sim.vy0, sim.vx0, sim.vy0, sim.vz0, h);
    advect(sim, 3, sim.vz, sim.vz0, sim.vx0, sim.vy0, sim.vz0, h);
    project(sim);
    // scalar step
    sim.dens0.set(sim.dens);
    sim.temp0.set(sim.temp);
    advect(sim, 0, sim.dens, sim.dens0, sim.vx, sim.vy, sim.vz, h);
    advect(sim, 0, sim.temp, sim.temp0, sim.vx, sim.vy, sim.vz, h);
    // dissipation + cooling
    const dDecay = Math.max(0, 1 - sim.params.dissipation * h);
    const tDecay = Math.max(0, 1 - sim.params.cooling * h);
    for (let i = 0; i < sim.n; i++) { sim.dens[i] *= dDecay; sim.temp[i] *= tDecay; }
    sim.frame++;
  }
  writeBack(sim);
  return { ok: true, frame: sim.frame, ...pyroStats(uuid).stats };
}

export function pyroStats(uuid) {
  const sim = _sims.get(uuid);
  if (!sim) return { ok: false };
  let totalDens = 0, maxTemp = 0, maxSpeed = 0, active = 0;
  for (let i = 0; i < sim.n; i++) {
    const d = sim.dens[i];
    totalDens += d;
    if (d > 0.01) active++;
    if (sim.temp[i] > maxTemp) maxTemp = sim.temp[i];
    const sp = Math.abs(sim.vx[i]) + Math.abs(sim.vy[i]) + Math.abs(sim.vz[i]);
    if (sp > maxSpeed) maxSpeed = sp;
  }
  return {
    ok: true,
    stats: {
      frame: sim.frame,
      totalDensity: totalDens,
      activeCells: active,
      maxTemperature: maxTemp,
      maxSpeed,
      emitters: sim.emitters.length,
    },
  };
}

export function resetPyro(uuid) {
  const sim = _sims.get(uuid);
  if (!sim) return { ok: false };
  sim.vx.fill(0); sim.vy.fill(0); sim.vz.fill(0);
  sim.dens.fill(0); sim.temp.fill(0);
  sim.frame = 0;
  writeBack(sim);
  return { ok: true };
}

export function deletePyro(uuid) {
  return { ok: _sims.delete(uuid) };
}

export function listPyro() {
  return Array.from(_sims.values()).map((s) => ({
    uuid: s.uuid, frame: s.frame, emitters: s.emitters.length,
    sx: s.sx, sy: s.sy, sz: s.sz,
  }));
}
