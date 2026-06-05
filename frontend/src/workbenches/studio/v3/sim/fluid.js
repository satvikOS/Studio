// ArchDisc Studio V3 — SPH-lite particle fluid.
//
// Smoothed-Particle Hydrodynamics is the standard meshless approach for
// liquids: each particle carries mass, velocity, density and pressure
// derived from its neighbours weighted by a smoothing kernel W(r,h)
// (Müller, Charypar, Gross — SCA 2003). Three force fields drive the
// motion:
//
//   • pressure    — repels neighbours when local density > rest density
//                    (poly6 kernel for density, spiky kernel gradient
//                     for pressure force).
//   • viscosity   — diffuses velocity differences (viscosity kernel
//                    Laplacian).
//   • gravity     — uniform body force.
//
// "SPH-lite" because we use a single Eulerian sub-step per frame, a
// fixed neighbour radius, and the smoothing constants are tuned for
// visual plausibility — not for accurate fluid behaviour at any real
// scale. The simulation is bounded by a fixed AABB box; collisions
// clamp position and reverse velocity with restitution.
//
// Acceleration structure: uniform hash grid keyed by cell = floor(p/h).
// Each frame we rebuild the grid (rebuilding is cheaper than maintaining
// when particles move fast). A single neighbour lookup pass collects
// {density, pressure, accel} per particle, then integrate.
//
// Rendered as THREE.Points with vertexColors (low density → blue, high
// density → cyan/white) so the user sees pressure waves.

import * as THREE from 'three';

const FLUID_TAG = 'archdiscStudioFluid';

function getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function findFluid(uuid) {
  const scene = getScene();
  if (!scene) return null;
  let p = null;
  scene.traverse((o) => {
    if (p) return;
    if (o.uuid === uuid && o.userData && o.userData[FLUID_TAG]) p = o;
  });
  return p;
}

function allFluids() {
  const scene = getScene();
  if (!scene) return [];
  const out = [];
  scene.traverse((o) => { if (o.userData && o.userData[FLUID_TAG]) out.push(o); });
  return out;
}

// Smoothing kernels (3D). h is the support radius.
//   W_poly6(r,h)  = 315 / (64π h⁹) · (h² - r²)³,   r ≤ h
//   ∇W_spiky(r,h) = -45 / (π h⁶) · (h - r)² · r̂,  r ≤ h
//   ∇²W_visc(r,h) =  45 / (π h⁶) · (h - r),       r ≤ h

function precomputeKernels(h) {
  const h2 = h * h;
  return {
    h, h2,
    poly6:        315 / (64 * Math.PI * Math.pow(h, 9)),
    spikyGrad:   -45 / (Math.PI * Math.pow(h, 6)),
    viscLapl:     45 / (Math.PI * Math.pow(h, 6)),
  };
}

export function fluidCreate(count, boxSize, opts) {
  const scene = getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  const N = Math.max(8, Math.min(4000, Math.floor(Number(count) || 600)));
  const box = Math.max(0.5, Math.min(20, Number(boxSize) || 3));
  const o = opts || {};

  const positions = new Float32Array(N * 3);
  const colors    = new Float32Array(N * 3);
  const vels      = new Float32Array(N * 3);
  const density   = new Float32Array(N);
  const pressure  = new Float32Array(N);

  // Initialise particles in a cube near the top of the box, packed in a
  // jittered grid so they don't all start at identical positions
  // (which would cause divide-by-zero in the kernel).
  const side = Math.ceil(Math.cbrt(N));
  const spacing = box / (side + 1) * 0.6;
  const startX = -box * 0.25;
  const startY = box * 0.25;
  const startZ = -box * 0.25;
  let pi = 0;
  for (let ix = 0; ix < side && pi < N; ix++) {
    for (let iy = 0; iy < side && pi < N; iy++) {
      for (let iz = 0; iz < side && pi < N; iz++) {
        positions[pi * 3]     = startX + ix * spacing + (Math.random() - 0.5) * 0.001;
        positions[pi * 3 + 1] = startY + iy * spacing + (Math.random() - 0.5) * 0.001;
        positions[pi * 3 + 2] = startZ + iz * spacing + (Math.random() - 0.5) * 0.001;
        colors[pi * 3]     = 0.2;
        colors[pi * 3 + 1] = 0.5;
        colors[pi * 3 + 2] = 1.0;
        pi++;
      }
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geom.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
  const mat = new THREE.PointsMaterial({
    size: Number(o.size) || 0.08,
    vertexColors: true,
    transparent: true,
    opacity: 0.95,
    depthWrite: false,
  });
  const pts = new THREE.Points(geom, mat);
  pts.name = o.name || `fluid-${(allFluids().length + 1)}`;

  // Visualise the containment box so the user sees where the fluid is
  // bounded. A thin LineSegments helper child.
  if (o.showBox !== false) {
    const half = box * 0.5;
    const bgeom = new THREE.BoxGeometry(box, box, box);
    const edges = new THREE.EdgesGeometry(bgeom);
    bgeom.dispose();
    const lines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({
      color: o.boxColor != null ? o.boxColor : 0x4488ff,
      transparent: true,
      opacity: 0.35,
    }));
    lines.position.set(0, half, 0);
    lines.userData.archdiscStudioFluidBox = true;
    pts.add(lines);
  }

  pts.userData[FLUID_TAG] = {
    count: N,
    box,
    positions, vels, colors, density, pressure,
    initial: new Float32Array(positions),
    mass:           Number(o.mass)           || 1.0,
    restDensity:    Number(o.restDensity)    || 600,
    gasConstant:    Number(o.gasConstant)    || 200,
    viscosity:      Number(o.viscosity)      || 50,
    h:              Number(o.h)              || 0.18,
    gravity:        Array.isArray(o.gravity) ? o.gravity.slice() : [0, -9.81, 0],
    bounce:         Number(o.bounce)         != null ? Number(o.bounce) : 0.3,
    kernels:        precomputeKernels(Number(o.h) || 0.18),
    grid:           new Map(),
  };
  pts.userData.archdiscStudioPrimitive = true;
  pts.userData.archdiscStudioPrimitiveKind = 'fluid';
  scene.add(pts);
  if (typeof window !== 'undefined' && window.__studioToast) {
    window.__studioToast(`Fluid ${N} particles`, 'ok');
  }
  return { ok: true, uuid: pts.uuid, count: N, box };
}

export function fluidList() {
  return {
    ok: true,
    fluids: allFluids().map((p) => ({
      uuid: p.uuid,
      name: p.name,
      count: p.userData[FLUID_TAG].count,
      box: p.userData[FLUID_TAG].box,
    })),
  };
}

export function fluidStep(dt) {
  const step = Math.max(1e-4, Math.min(0.03, Number(dt) || 0.016));
  const fluids = allFluids();
  if (!fluids.length) return { ok: false, error: 'no fluids' };
  for (const p of fluids) stepOne(p, step);
  return { ok: true, count: fluids.length, dt: step };
}

// One sub-step of SPH-lite. The grid lookup is O(N) amortised because
// each cell touches ≤ ~27 cells × density bound.
function stepOne(pts, dt) {
  const f = pts.userData[FLUID_TAG];
  if (!f) return;
  const {
    positions, vels, colors, density, pressure,
    mass, restDensity, gasConstant, viscosity, gravity, bounce, box,
    kernels, grid, count,
  } = f;
  const { h, h2, poly6, spikyGrad, viscLapl } = kernels;

  // --- rebuild uniform grid ---
  grid.clear();
  const cellKey = (cx, cy, cz) => `${cx},${cy},${cz}`;
  for (let i = 0; i < count; i++) {
    const cx = Math.floor(positions[i * 3]     / h);
    const cy = Math.floor(positions[i * 3 + 1] / h);
    const cz = Math.floor(positions[i * 3 + 2] / h);
    const key = cellKey(cx, cy, cz);
    let arr = grid.get(key);
    if (!arr) { arr = []; grid.set(key, arr); }
    arr.push(i);
  }

  // Reusable neighbour buffer — reset per particle.
  const NMAX = 96;
  const neigh = new Int32Array(NMAX);

  // --- density + pressure ---
  for (let i = 0; i < count; i++) {
    const cx = Math.floor(positions[i * 3]     / h);
    const cy = Math.floor(positions[i * 3 + 1] / h);
    const cz = Math.floor(positions[i * 3 + 2] / h);
    let nCount = 0;
    let rho = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const arr = grid.get(cellKey(cx + dx, cy + dy, cz + dz));
          if (!arr) continue;
          for (let k = 0; k < arr.length; k++) {
            const j = arr[k];
            const rx = positions[i * 3]     - positions[j * 3];
            const ry = positions[i * 3 + 1] - positions[j * 3 + 1];
            const rz = positions[i * 3 + 2] - positions[j * 3 + 2];
            const r2 = rx * rx + ry * ry + rz * rz;
            if (r2 < h2) {
              const x = h2 - r2;
              rho += mass * poly6 * x * x * x;
              if (j !== i && nCount < NMAX) neigh[nCount++] = j;
            }
          }
        }
      }
    }
    density[i] = rho;
    pressure[i] = gasConstant * Math.max(0, rho - restDensity);
    // Cache neighbour list inside hash via a parallel array? Too much
    // alloc — re-look-up in force pass below. Empirically the extra
    // hash hits are cheaper than allocating per-particle Int32Arrays.
  }

  // --- forces (pressure + viscosity + gravity) → integrate ---
  for (let i = 0; i < count; i++) {
    const cx = Math.floor(positions[i * 3]     / h);
    const cy = Math.floor(positions[i * 3 + 1] / h);
    const cz = Math.floor(positions[i * 3 + 2] / h);
    let fx = 0, fy = 0, fz = 0;
    const rhoI = density[i] || 1e-6;
    const presI = pressure[i];

    for (let ddx = -1; ddx <= 1; ddx++) {
      for (let ddy = -1; ddy <= 1; ddy++) {
        for (let ddz = -1; ddz <= 1; ddz++) {
          const arr = grid.get(cellKey(cx + ddx, cy + ddy, cz + ddz));
          if (!arr) continue;
          for (let k = 0; k < arr.length; k++) {
            const j = arr[k];
            if (j === i) continue;
            const rx = positions[i * 3]     - positions[j * 3];
            const ry = positions[i * 3 + 1] - positions[j * 3 + 1];
            const rz = positions[i * 3 + 2] - positions[j * 3 + 2];
            const r2 = rx * rx + ry * ry + rz * rz;
            if (r2 >= h2) continue;
            const r = Math.sqrt(r2);
            if (r < 1e-6) continue;
            const rhoJ = density[j] || 1e-6;

            // Pressure: −m_j · (p_i + p_j)/(2 ρ_j) · ∇W_spiky
            const presJ = pressure[j];
            const fpMag = -mass * (presI + presJ) / (2 * rhoJ) * spikyGrad * (h - r) * (h - r) / r;
            fx += fpMag * rx;
            fy += fpMag * ry;
            fz += fpMag * rz;

            // Viscosity: μ · m_j · (v_j - v_i)/ρ_j · ∇²W_visc
            const fvCoef = viscosity * mass / rhoJ * viscLapl * (h - r);
            fx += fvCoef * (vels[j * 3]     - vels[i * 3]);
            fy += fvCoef * (vels[j * 3 + 1] - vels[i * 3 + 1]);
            fz += fvCoef * (vels[j * 3 + 2] - vels[i * 3 + 2]);
          }
        }
      }
    }

    // Gravity body force.
    fx += gravity[0] * rhoI;
    fy += gravity[1] * rhoI;
    fz += gravity[2] * rhoI;

    // Acceleration = f / ρ. Integrate velocity then position.
    vels[i * 3]     += dt * fx / rhoI;
    vels[i * 3 + 1] += dt * fy / rhoI;
    vels[i * 3 + 2] += dt * fz / rhoI;
    positions[i * 3]     += dt * vels[i * 3];
    positions[i * 3 + 1] += dt * vels[i * 3 + 1];
    positions[i * 3 + 2] += dt * vels[i * 3 + 2];

    // Box collision: AABB centred on (0, box/2, 0) with side `box`.
    const halfX = box * 0.5;
    const halfZ = box * 0.5;
    const minY = 0, maxY = box;
    if (positions[i * 3] < -halfX) { positions[i * 3] = -halfX; vels[i * 3]     *= -bounce; }
    if (positions[i * 3] >  halfX) { positions[i * 3] =  halfX; vels[i * 3]     *= -bounce; }
    if (positions[i * 3 + 2] < -halfZ) { positions[i * 3 + 2] = -halfZ; vels[i * 3 + 2] *= -bounce; }
    if (positions[i * 3 + 2] >  halfZ) { positions[i * 3 + 2] =  halfZ; vels[i * 3 + 2] *= -bounce; }
    if (positions[i * 3 + 1] < minY) { positions[i * 3 + 1] = minY; vels[i * 3 + 1] *= -bounce; }
    if (positions[i * 3 + 1] > maxY) { positions[i * 3 + 1] = maxY; vels[i * 3 + 1] *= -bounce; }

    // Density-based colour (blue → cyan → white as ρ grows).
    const t = Math.min(1, Math.max(0, (rhoI - restDensity * 0.5) / (restDensity * 1.5)));
    colors[i * 3]     = 0.2 + t * 0.8;
    colors[i * 3 + 1] = 0.5 + t * 0.5;
    colors[i * 3 + 2] = 1.0;
  }

  pts.geometry.attributes.position.needsUpdate = true;
  pts.geometry.attributes.color.needsUpdate = true;
  pts.geometry.computeBoundingSphere();
}

export function fluidReset(uuid) {
  const pts = findFluid(uuid); if (!pts) return { ok: false, error: 'no fluid' };
  const f = pts.userData[FLUID_TAG];
  for (let i = 0; i < f.count; i++) {
    f.positions[i * 3]     = f.initial[i * 3];
    f.positions[i * 3 + 1] = f.initial[i * 3 + 1];
    f.positions[i * 3 + 2] = f.initial[i * 3 + 2];
    f.vels[i * 3] = 0; f.vels[i * 3 + 1] = 0; f.vels[i * 3 + 2] = 0;
  }
  pts.geometry.attributes.position.needsUpdate = true;
  return { ok: true };
}

export function fluidResetAll() {
  for (const p of allFluids()) fluidReset(p.uuid);
  return { ok: true };
}

export function fluidRemove(uuid) {
  const pts = findFluid(uuid); if (!pts) return { ok: false, error: 'no fluid' };
  if (pts.parent) pts.parent.remove(pts);
  if (pts.geometry && typeof pts.geometry.dispose === 'function') pts.geometry.dispose();
  if (pts.material && typeof pts.material.dispose === 'function') pts.material.dispose();
  return { ok: true };
}
