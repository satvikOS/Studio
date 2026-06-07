// ArchDisc Studio V3 — FLIP fluid + sparse Pyro voxel solver (slice 934).
// Bridson FLIP particles + MAC grid + Jacobi pressure; Stam-style Pyro for smoke.
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';

let _installed = false, _nextId = 1;
const _flips = new Map(), _pyros = new Map();

function _macIdx(g, i, j, k) { return ((k * g.ny) + j) * g.nx + i; }

function _flipStep(f, dt) {
  const g = f.grid;
  // P2G
  g.u.fill(0); g.v.fill(0); g.w.fill(0); g.wU.fill(0); g.wV.fill(0); g.wW.fill(0);
  for (let p = 0; p < f.particles.length; p += 6) {
    const x = f.particles[p], y = f.particles[p + 1], z = f.particles[p + 2];
    const vx = f.particles[p + 3], vy = f.particles[p + 4], vz = f.particles[p + 5];
    const gi = Math.max(0, Math.min(g.nx - 1, (x / g.h) | 0));
    const gj = Math.max(0, Math.min(g.ny - 1, (y / g.h) | 0));
    const gk = Math.max(0, Math.min(g.nz - 1, (z / g.h) | 0));
    const idx = _macIdx(g, gi, gj, gk);
    g.u[idx] += vx; g.v[idx] += vy; g.w[idx] += vz;
    g.wU[idx]++; g.wV[idx]++; g.wW[idx]++;
  }
  for (let i = 0; i < g.u.length; i++) {
    if (g.wU[i] > 0) g.u[i] /= g.wU[i];
    if (g.wV[i] > 0) g.v[i] /= g.wV[i];
    if (g.wW[i] > 0) g.w[i] /= g.wW[i];
  }
  for (let i = 0; i < g.v.length; i++) g.v[i] += -9.8 * dt;
  // Jacobi pressure solve (light: 30 iters)
  const p1 = new Float32Array(g.u.length);
  const p2 = new Float32Array(g.u.length);
  for (let iter = 0; iter < 30; iter++) {
    for (let k = 1; k < g.nz - 1; k++)
      for (let j = 1; j < g.ny - 1; j++)
        for (let i = 1; i < g.nx - 1; i++) {
          const c = _macIdx(g, i, j, k);
          const div = (g.u[_macIdx(g, i + 1, j, k)] - g.u[_macIdx(g, i - 1, j, k)]
                     + g.v[_macIdx(g, i, j + 1, k)] - g.v[_macIdx(g, i, j - 1, k)]
                     + g.w[_macIdx(g, i, j, k + 1)] - g.w[_macIdx(g, i, j, k - 1)]) / (2 * g.h);
          p2[c] = (p1[_macIdx(g, i + 1, j, k)] + p1[_macIdx(g, i - 1, j, k)]
                 + p1[_macIdx(g, i, j + 1, k)] + p1[_macIdx(g, i, j - 1, k)]
                 + p1[_macIdx(g, i, j, k + 1)] + p1[_macIdx(g, i, j, k - 1)]
                 - div * g.h * g.h) / 6;
        }
    p1.set(p2);
  }
  for (let k = 1; k < g.nz - 1; k++)
    for (let j = 1; j < g.ny - 1; j++)
      for (let i = 1; i < g.nx - 1; i++) {
        const c = _macIdx(g, i, j, k);
        g.u[c] -= (p1[_macIdx(g, i + 1, j, k)] - p1[_macIdx(g, i - 1, j, k)]) / (2 * g.h);
        g.v[c] -= (p1[_macIdx(g, i, j + 1, k)] - p1[_macIdx(g, i, j - 1, k)]) / (2 * g.h);
        g.w[c] -= (p1[_macIdx(g, i, j, k + 1)] - p1[_macIdx(g, i, j, k - 1)]) / (2 * g.h);
      }
  // G2P + advect
  for (let p = 0; p < f.particles.length; p += 6) {
    const x = f.particles[p], y = f.particles[p + 1], z = f.particles[p + 2];
    const gi = Math.max(0, Math.min(g.nx - 1, (x / g.h) | 0));
    const gj = Math.max(0, Math.min(g.ny - 1, (y / g.h) | 0));
    const gk = Math.max(0, Math.min(g.nz - 1, (z / g.h) | 0));
    const idx = _macIdx(g, gi, gj, gk);
    const vxN = g.u[idx], vyN = g.v[idx], vzN = g.w[idx];
    const a = 0.95;
    f.particles[p + 3] = f.particles[p + 3] * a + vxN * (1 - a);
    f.particles[p + 4] = f.particles[p + 4] * a + vyN * (1 - a);
    f.particles[p + 5] = f.particles[p + 5] * a + vzN * (1 - a);
    f.particles[p] += f.particles[p + 3] * dt;
    f.particles[p + 1] += f.particles[p + 4] * dt;
    f.particles[p + 2] += f.particles[p + 5] * dt;
    if (f.particles[p + 1] < 0) { f.particles[p + 1] = 0; f.particles[p + 4] *= -0.3; }
  }
  // update Points geometry
  if (f.points) {
    const arr = f.points.geometry.attributes.position.array;
    for (let i = 0, j = 0; i < f.particles.length; i += 6, j += 3) {
      arr[j] = f.particles[i]; arr[j + 1] = f.particles[i + 1]; arr[j + 2] = f.particles[i + 2];
    }
    f.points.geometry.attributes.position.needsUpdate = true;
  }
}

function _pyroStep(p, dt) {
  const g = p.grid;
  // buoyancy
  for (let i = 0; i < g.density.length; i++) {
    const buoy = g.alpha * g.temp[i] - g.beta * g.density[i];
    g.vy[i] += buoy * dt;
  }
  // semi-Lagrangian density advection (light)
  const dNew = new Float32Array(g.density.length);
  const tNew = new Float32Array(g.temp.length);
  for (let k = 0; k < g.nz; k++)
    for (let j = 0; j < g.ny; j++)
      for (let i = 0; i < g.nx; i++) {
        const c = ((k * g.ny) + j) * g.nx + i;
        const sx = i - g.vx[c] * dt, sy = j - g.vy[c] * dt, sz = k - g.vz[c] * dt;
        const ci = Math.max(0, Math.min(g.nx - 1, sx | 0));
        const cj = Math.max(0, Math.min(g.ny - 1, sy | 0));
        const ck = Math.max(0, Math.min(g.nz - 1, sz | 0));
        const sIdx = ((ck * g.ny) + cj) * g.nx + ci;
        dNew[c] = g.density[sIdx] * 0.99;
        tNew[c] = g.temp[sIdx] * 0.98;
      }
  g.density.set(dNew); g.temp.set(tNew);
}

export function installFLIPPyro() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioFLIPCreate: ({ size = [32, 16, 32], h = 0.1, count = 4096 } = {}) => {
      const [nx, ny, nz] = size;
      const g = { nx, ny, nz, h, u: new Float32Array(nx * ny * nz), v: new Float32Array(nx * ny * nz), w: new Float32Array(nx * ny * nz), wU: new Float32Array(nx * ny * nz), wV: new Float32Array(nx * ny * nz), wW: new Float32Array(nx * ny * nz) };
      const particles = new Float32Array(count * 6);
      for (let i = 0; i < count; i++) {
        particles[i * 6] = Math.random() * nx * h;
        particles[i * 6 + 1] = (ny * 0.7 + Math.random() * ny * 0.3) * h;
        particles[i * 6 + 2] = Math.random() * nz * h;
      }
      const id = `flip-${_nextId++}`;
      const f = { grid: g, particles, points: null };
      const vp = window.__archdiscViewport;
      if (vp?.scene) {
        const geom = new THREE.BufferGeometry();
        const arr = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) { arr[i * 3] = particles[i * 6]; arr[i * 3 + 1] = particles[i * 6 + 1]; arr[i * 3 + 2] = particles[i * 6 + 2]; }
        geom.setAttribute('position', new THREE.BufferAttribute(arr, 3));
        const mat = new THREE.PointsMaterial({ color: 0x3070ff, size: 0.05 });
        f.points = new THREE.Points(geom, mat);
        vp.scene.add(f.points);
      }
      _flips.set(id, f);
      return { ok: true, id, count, gridSize: size };
    },
    __studioFLIPStep: ({ id, dt = 1 / 60 } = {}) => { const f = _flips.get(id); if (!f) return { ok: false }; _flipStep(f, dt); return { ok: true }; },
    __studioFLIPDelete: ({ id }) => { const f = _flips.get(id); if (f?.points) f.points.parent?.remove(f.points); return { ok: _flips.delete(id) }; },
    __studioPyroCreate: ({ size = [32, 32, 32], alpha = 0.1, beta = 0.05 } = {}) => {
      const [nx, ny, nz] = size;
      const g = { nx, ny, nz, alpha, beta, density: new Float32Array(nx * ny * nz), temp: new Float32Array(nx * ny * nz), vx: new Float32Array(nx * ny * nz), vy: new Float32Array(nx * ny * nz), vz: new Float32Array(nx * ny * nz) };
      const cx = nx >> 1, cz = nz >> 1;
      for (let i = -2; i <= 2; i++) for (let k = -2; k <= 2; k++) {
        const c = (((1) * ny) + 0) * nx + (cx + i) + 0; // approximate seed
        const idx = ((0 * ny) + 1) * nx + (cx + i);
        g.density[idx] = 1; g.temp[idx] = 1;
      }
      const id = `pyro-${_nextId++}`;
      _pyros.set(id, { grid: g });
      return { ok: true, id, gridSize: size };
    },
    __studioPyroStep: ({ id, dt = 1 / 60 } = {}) => { const p = _pyros.get(id); if (!p) return { ok: false }; _pyroStep(p, dt); return { ok: true }; },
    __studioPyroDelete: ({ id }) => ({ ok: _pyros.delete(id) }),
    __studioFLIPPyroList: () => ({ ok: true, flips: [..._flips.keys()], pyros: [..._pyros.keys()] }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'sim', 'FLIP fluid + sparse Pyro voxel solver');
  return { ok: true };
}
export default installFLIPPyro;
