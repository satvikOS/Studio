// Slice 785 — OpenVDB-tier volume ops on top of the slice-751 sparse VDB.
//
// Surfaces six high-level operators that mirror OpenVDB's standard
// toolset:
//
//   • __studioVDBAdvect({name, velocityName, dt})  — semi-Lagrangian
//     advection of a scalar field by a velocity field. velocityName
//     identifies a vector field stored as three sparse VDBs:
//         `${velocityName}.x`, `.y`, `.z`
//     Missing components are treated as zero.
//
//   • __studioVDBDilate({name, voxels})            — N-step 1-voxel
//     6-connected dilate (max filter). Grows topology.
//
//   • __studioVDBErode({name, voxels})             — N-step 1-voxel
//     6-connected erode (min filter). Shrinks topology.
//
//   • __studioVDBSmooth({name, sigma})             — Gaussian smooth
//     via three separable 1D passes; sigma is in voxel units.
//
//   • __studioVDBGradient({name, outName})         — central-difference
//     gradient. Writes three sparse VDBs `${outName}.x/.y/.z`.
//
//   • __studioVDBDivergence({name, outName})       — central-difference
//     divergence. Reads `${name}.x/.y/.z`, writes scalar `outName`.
//
// All ops mutate the sparse store registry that lives in
// `volume/vdbIndex.js` via its `_peekStores` helper. We do not duplicate
// the registry. New stores allocated as gradient/divergence outputs are
// inserted with the slice-751 `__studioVDBCreate` op so they're visible
// to `__studioVDBList`, `__studioVDBStats`, etc.

import { registerOps, unregisterOps } from '../common/registry.js';
import { SparseVDB } from '../volume/sparseVDB.js';
import { _peekStores } from '../volume/vdbIndex.js';
import { advectInPlace } from './vdbAdvect.js';
import { dilate, erode } from './vdbMorph.js';
import { smoothGaussian } from './vdbSmooth.js';
import { gradient, divergence } from './vdbCalc.js';

let _installed = false;

const OP_NAMES = [
  '__studioVDBAdvect',
  '__studioVDBDilate',
  '__studioVDBErode',
  '__studioVDBSmooth',
  '__studioVDBGradient',
  '__studioVDBDivergence',
];

function _store(name) {
  return _peekStores().get(String(name || ''));
}

// Ensure a store with the given name exists (returns the existing or a
// freshly-allocated one). Mirrors the tile size of `seedStore` if a new
// one is allocated so component layouts line up.
function _ensureStore(name, seedStore) {
  const k = String(name || '');
  if (!k) return null;
  const map = _peekStores();
  let s = map.get(k);
  if (s) return s;
  s = new SparseVDB(k, seedStore ? seedStore.tileSize : 8);
  map.set(k, s);
  return s;
}

function opAdvect(args) {
  const a = args || {};
  const src = _store(a.name);
  if (!src) return { ok: false, error: 'no such store' };
  const v = String(a.velocityName || '');
  const vx = _store(v + '.x') || null;
  const vy = _store(v + '.y') || null;
  const vz = _store(v + '.z') || null;
  const dt = Number(a.dt) || 0;
  const r = advectInPlace(src, vx, vy, vz, dt);
  return { ok: !!r.ok, voxelsWritten: r.voxelsWritten, dt: r.dt };
}

function opDilate(args) {
  const a = args || {};
  const s = _store(a.name);
  if (!s) return { ok: false, error: 'no such store' };
  const r = dilate(s, a.voxels);
  return { ok: !!r.ok, iterations: r.iterations, voxelsWritten: r.voxelsWritten };
}

function opErode(args) {
  const a = args || {};
  const s = _store(a.name);
  if (!s) return { ok: false, error: 'no such store' };
  const r = erode(s, a.voxels);
  return { ok: !!r.ok, iterations: r.iterations, voxelsWritten: r.voxelsWritten };
}

function opSmooth(args) {
  const a = args || {};
  const s = _store(a.name);
  if (!s) return { ok: false, error: 'no such store' };
  const r = smoothGaussian(s, a.sigma);
  return {
    ok: !!r.ok,
    sigma: r.sigma,
    kernelHalfWidth: r.kernelHalfWidth,
    passes: r.passes,
  };
}

function opGradient(args) {
  const a = args || {};
  const src = _store(a.name);
  if (!src) return { ok: false, error: 'no such store' };
  const outName = String(a.outName || '').trim();
  if (!outName) return { ok: false, error: 'outName required' };
  const dx = _ensureStore(outName + '.x', src);
  const dy = _ensureStore(outName + '.y', src);
  const dz = _ensureStore(outName + '.z', src);
  if (!dx || !dy || !dz) return { ok: false, error: 'failed to allocate output components' };
  // Reset output components so re-runs are deterministic.
  dx.clear(); dy.clear(); dz.clear();
  const r = gradient(src, dx, dy, dz);
  return { ok: !!r.ok, voxelsWritten: r.voxelsWritten, outNames: [outName + '.x', outName + '.y', outName + '.z'] };
}

function opDivergence(args) {
  const a = args || {};
  const base = String(a.name || '');
  const vx = _store(base + '.x') || null;
  const vy = _store(base + '.y') || null;
  const vz = _store(base + '.z') || null;
  if (!vx && !vy && !vz) return { ok: false, error: 'no component stores ' + base + '.x/.y/.z' };
  const outName = String(a.outName || '').trim();
  if (!outName) return { ok: false, error: 'outName required' };
  const seed = vx || vy || vz;
  const dst = _ensureStore(outName, seed);
  if (!dst) return { ok: false, error: 'failed to allocate output store' };
  dst.clear();
  const r = divergence(vx, vy, vz, dst);
  return { ok: !!r.ok, voxelsWritten: r.voxelsWritten, outName };
}

export function installVDBOps() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioVDBOpsInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioVDBOpsInstalled = true;
  const ops = {
    __studioVDBAdvect: [opAdvect,
      'Semi-Lagrangian advection of a sparse VDB scalar by a velocity field {name, velocityName, dt}.'],
    __studioVDBDilate: [opDilate,
      'N-step 1-voxel 6-connected dilate (max filter) on a sparse VDB store {name, voxels}.'],
    __studioVDBErode: [opErode,
      'N-step 1-voxel 6-connected erode (min filter) on a sparse VDB store {name, voxels}.'],
    __studioVDBSmooth: [opSmooth,
      'Gaussian smooth via three separable 1D passes on a sparse VDB store {name, sigma}.'],
    __studioVDBGradient: [opGradient,
      'Central-difference gradient → three sparse VDB component stores ({name, outName} → outName.x/.y/.z).'],
    __studioVDBDivergence: [opDivergence,
      'Central-difference divergence of a sparse VDB vector field ({name, outName} reads name.x/.y/.z).'],
  };
  registerOps(
    ops,
    'volume',
    'OpenVDB-tier sparse-volume ops (advect/dilate/erode/smooth/gradient/divergence — slice 785).'
  );
  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallVDBOps() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  unregisterOps(OP_NAMES);
  _installed = false;
  window.__studioVDBOpsInstalled = false;
  return { ok: true };
}

export default installVDBOps;
