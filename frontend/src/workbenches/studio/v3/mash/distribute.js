// Slice 753 — Maya MASH Distribute modes.
//
// Pure functions that build THREE.Matrix4[] for the five canonical Maya
// MASH distribute shapes: linear / grid / radial / spiral / Fibonacci.
// No scene access, no side effects — callable from the headless test
// pipeline or the per-effector re-evaluation path.

import * as THREE from 'three';

const _PI2 = Math.PI * 2;
const _GOLDEN = Math.PI * (3 - Math.sqrt(5));

// Helper: build a translation-only Matrix4 from (x,y,z).
function _tMatrix(x, y, z) {
  const m = new THREE.Matrix4();
  m.makeTranslation(x, y, z);
  return m;
}

// Helper: translation + Y-axis rotation (used by radial so each clone
// faces outward — Maya MASH default for the radial mode).
function _tyrMatrix(x, y, z, ry) {
  const m = new THREE.Matrix4();
  m.makeRotationY(ry);
  m.setPosition(x, y, z);
  return m;
}

// ── linear ───────────────────────────────────────────────────────────
// pos = start + i * spacing. start defaults to (0,0,0); spacing
// accepts an [x,y,z] tuple or a 3-vector.
export function linearMatrices(count, start, spacing) {
  const N = Math.max(0, count | 0);
  const s = Array.isArray(start) ? start : [0, 0, 0];
  const d = Array.isArray(spacing) ? spacing : [1, 0, 0];
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    out[i] = _tMatrix(s[0] + d[0] * i, s[1] + d[1] * i, s[2] + d[2] * i);
  }
  return out;
}

// ── grid ─────────────────────────────────────────────────────────────
// pos = ((ix - nx/2) * sx, (iy - ny/2) * sy, (iz - nz/2) * sz).
// Walks ix×iy×iz in row-major order; total count = nx*ny*nz.
export function gridMatrices(nx, ny, nz, spacing) {
  const X = Math.max(1, nx | 0);
  const Y = Math.max(1, ny | 0);
  const Z = Math.max(1, nz | 0);
  const s = Array.isArray(spacing) ? spacing : [1, 1, 1];
  const out = new Array(X * Y * Z);
  let k = 0;
  for (let ix = 0; ix < X; ix++) {
    for (let iy = 0; iy < Y; iy++) {
      for (let iz = 0; iz < Z; iz++) {
        out[k++] = _tMatrix(
          (ix - X / 2) * s[0],
          (iy - Y / 2) * s[1],
          (iz - Z / 2) * s[2],
        );
      }
    }
  }
  return out;
}

// ── radial ───────────────────────────────────────────────────────────
// a = 2π * i / count; pos = (cos(a)*r, 0, sin(a)*r); rot.y = -a so each
// clone faces inward along the ring tangent (Maya MASH default).
export function radialMatrices(count, radius) {
  const N = Math.max(0, count | 0);
  const r = Number(radius) || 1;
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = (_PI2 * i) / Math.max(1, N);
    out[i] = _tyrMatrix(Math.cos(a) * r, 0, Math.sin(a) * r, -a);
  }
  return out;
}

// ── spiral ───────────────────────────────────────────────────────────
// a = i * angleStep; r = r0 + i * rStep; pos = (cos*r, i*hStep, sin*r).
// Builds an Archimedean helix (constant Δangle, linear Δradius +
// Δheight). Identical to the Maya MASH "spiral" distribute mode.
export function spiralMatrices(count, r0, rStep, angleStep, hStep) {
  const N = Math.max(0, count | 0);
  const R0 = Number(r0) || 0;
  const dR = Number(rStep) || 0;
  const dA = Number(angleStep) || 0;
  const dH = Number(hStep) || 0;
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = i * dA;
    const r = R0 + i * dR;
    out[i] = _tMatrix(Math.cos(a) * r, i * dH, Math.sin(a) * r);
  }
  return out;
}

// ── fibonacci ────────────────────────────────────────────────────────
// Sunflower/golden-angle disc layout. golden = π·(3-√5); a = i*golden;
// r = R·√((i+0.5)/count); pos = (cos*r, 0, sin*r). Produces the even
// vogel-spiral distribution Maya MASH uses for "fibonacci" mode.
export function fibonacciMatrices(count, R) {
  const N = Math.max(0, count | 0);
  const radius = Number(R) || 1;
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = i * _GOLDEN;
    const r = radius * Math.sqrt((i + 0.5) / Math.max(1, N));
    out[i] = _tMatrix(Math.cos(a) * r, 0, Math.sin(a) * r);
  }
  return out;
}
