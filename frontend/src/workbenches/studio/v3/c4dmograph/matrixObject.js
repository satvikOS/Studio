// Slice 773 — Cinema 4D MoGraph Matrix object.
//
// The Cinema 4D Matrix object is an *invisible* positioner: it
// produces an array of per-instance Matrix4 transforms (linear /
// grid / radial / spiral / fibonacci, mirroring slice 753's MASH
// distribute) but does NOT render its own geometry. The matrices
// are exposed so downstream ops (Plain / Delay / Inheritance /
// Random effectors below) can drive them, and so other systems
// (cloner, Tracer, Spline Wrap, MoSpline, etc.) can read them as a
// pure data source.
//
// This is the canonical C4D MoGraph trick: a Matrix object lets you
// preview the distribution without committing to a visible mesh,
// and then a Cloner / MoText / MoExtrude latches onto the matrices.
// Here we keep the surface minimal — a key, a mode, a count, the
// snapshot — and let the slice 753 InstancedMesh pipeline handle
// any actual rendering when the user wants it.
//
// Pure JS, zero scene access on create; the matrices are real
// THREE.Matrix4 instances so the snapshot fits straight into the
// arrange.js stack.

import * as THREE from 'three';

const _PI2 = Math.PI * 2;
const _GOLDEN = Math.PI * (3 - Math.sqrt(5));

// In-process registry of every Matrix object created. Exposed via
// listMatrixObjects() / getMatrixObject() for the ops layer.
const _matrices = new Map();
let _seq = 1;
function _key() { return `c4d-mtx-${_seq++}-${Date.now().toString(36)}`; }

// Helper: translation-only Matrix4 from (x, y, z).
function _tMatrix(x, y, z) {
  const m = new THREE.Matrix4();
  m.makeTranslation(x, y, z);
  return m;
}

// Helper: translation + Y-axis rotation. Mirrors the MASH radial
// behaviour so each ring clone faces outward along the tangent.
function _tyrMatrix(x, y, z, ry) {
  const m = new THREE.Matrix4();
  m.makeRotationY(ry);
  m.setPosition(x, y, z);
  return m;
}

// ── distribute builders ──────────────────────────────────────────────
// Identical math to slice 753's mash/distribute.js but inlined here so
// the Matrix object isn't yoked to the MASH module lifecycle. (The
// MASH replicate handle requires a sourceUuid; a C4D Matrix object
// is purposefully sourceless.)

function _linear(count, start, spacing) {
  const N = Math.max(0, count | 0);
  const s = Array.isArray(start) ? start : [0, 0, 0];
  const d = Array.isArray(spacing) ? spacing : [1, 0, 0];
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    out[i] = _tMatrix(s[0] + d[0] * i, s[1] + d[1] * i, s[2] + d[2] * i);
  }
  return out;
}

function _grid(nx, ny, nz, spacing) {
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

function _radial(count, radius) {
  const N = Math.max(0, count | 0);
  const r = Number(radius) || 1;
  const out = new Array(N);
  for (let i = 0; i < N; i++) {
    const a = (_PI2 * i) / Math.max(1, N);
    out[i] = _tyrMatrix(Math.cos(a) * r, 0, Math.sin(a) * r, -a);
  }
  return out;
}

function _spiral(count, r0, rStep, angleStep, hStep) {
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

function _fibonacci(count, R) {
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

// Build the matrices for a given mode. For 'grid' the count is
// derived from nx*ny*nz; everything else honours `count` as-is.
function _matricesFor(mode, count, params) {
  const p = params || {};
  switch (mode) {
    case 'linear':
      return _linear(count, p.start || [0, 0, 0], p.spacing || [1, 0, 0]);
    case 'grid': {
      const nx = (p.nx === undefined) ? 1 : (p.nx | 0);
      const ny = (p.ny === undefined) ? 1 : (p.ny | 0);
      const nz = (p.nz === undefined) ? 1 : (p.nz | 0);
      return _grid(nx, ny, nz, p.spacing || [1, 1, 1]);
    }
    case 'radial':
      return _radial(count, p.radius || 1);
    case 'spiral':
      return _spiral(
        count,
        p.r0 || 0,
        p.rStep || 0,
        (p.angleStep === undefined) ? 0.3 : p.angleStep,
        p.hStep || 0,
      );
    case 'fibonacci':
      return _fibonacci(count, p.R || p.radius || 1);
    default:
      return [];
  }
}

// Snapshot the matrix elements into a flat Float32-ish array so
// effectors can read the base position cheaply without decomposing
// a THREE.Matrix4 every call.
function _snapshotBase(matrices) {
  const N = matrices.length;
  const out = new Array(N);
  for (let i = 0; i < N; i++) out[i] = matrices[i].elements.slice(0);
  return out;
}

// Public — create a new Matrix object. `mode` selects distribute
// algorithm; `count` is honoured by linear/radial/spiral/fibonacci
// (grid derives its own from params.nx/ny/nz). Returns the handle
// key + actual instance count.
export function createMatrixObject(opts) {
  const o = opts || {};
  const mode = o.mode || 'linear';
  const count = (o.count === undefined) ? 10 : (o.count | 0);
  const matrices = _matricesFor(mode, count, o.params || {});
  if (!Array.isArray(matrices) || matrices.length === 0) {
    return { ok: false, error: 'unknown mode or zero count' };
  }
  const key = _key();
  _matrices.set(key, {
    key,
    mode,
    params: o.params || {},
    matrices,
    base: _snapshotBase(matrices),
    count: matrices.length,
  });
  return { ok: true, matrixKey: key, count: matrices.length };
}

// Public — read access for ops layer + effector functions.
export function getMatrixObject(key) {
  return _matrices.get(key) || null;
}

// Public — overwrite the matrix array (called by effectors after
// they've computed new transforms). Length must match.
export function setMatrices(key, newMatrices) {
  const h = _matrices.get(key);
  if (!h) return false;
  if (!Array.isArray(newMatrices) || newMatrices.length !== h.matrices.length) return false;
  h.matrices = newMatrices;
  return true;
}

// Public — reset matrices back to the base snapshot. Used when an
// effector that interpolates from base needs to know the unperturbed
// starting state (Delay effector mostly).
export function resetMatrices(key) {
  const h = _matrices.get(key);
  if (!h) return false;
  const N = h.base.length;
  const fresh = new Array(N);
  for (let i = 0; i < N; i++) {
    const m = new THREE.Matrix4();
    m.fromArray(h.base[i]);
    fresh[i] = m;
  }
  h.matrices = fresh;
  return true;
}

// Public — listing.
export function listMatrixObjects() {
  return Array.from(_matrices.values()).map((h) => ({
    key: h.key, mode: h.mode, count: h.count,
  }));
}

// Public — deletion (no scene side effects — matrices are pure data).
export function deleteMatrixObject(key) {
  return _matrices.delete(key);
}
