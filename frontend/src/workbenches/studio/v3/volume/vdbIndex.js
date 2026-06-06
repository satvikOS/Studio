// Slice 751 — Sparse VDB-style tile bookkeeping (installer + ops).
//
// Named-store registry over `SparseVDB` instances + the `__studioVDB*`
// command surface. Runs in parallel with the dense pyro path from
// slices 698 / 730 / 731 — installVolume() handles the dense ops, this
// module handles the sparse ones.

import { registerOps } from '../common/registry.js';
import { SparseVDB } from './sparseVDB.js';

let _installed = false;
const _vdbStores = new Map();   // name -> SparseVDB

function _getStore(name) {
  const k = String(name || '');
  return _vdbStores.get(k);
}

function _create(name, tileSize) {
  const k = String(name || '');
  if (!k) return { ok: false, error: 'name required' };
  if (_vdbStores.has(k)) return { ok: false, error: 'name already exists', name: k };
  const store = new SparseVDB(k, tileSize);
  _vdbStores.set(k, store);
  return { ok: true, name: k, tileSize: store.tileSize };
}

function _set(name, x, y, z, v) {
  const s = _getStore(name);
  if (!s) return { ok: false, error: 'no such store' };
  s.set(Math.floor(Number(x) || 0), Math.floor(Number(y) || 0), Math.floor(Number(z) || 0), Number(v) || 0);
  return { ok: true };
}

function _get(name, x, y, z) {
  const s = _getStore(name);
  if (!s) return { ok: false, error: 'no such store' };
  const v = s.get(Math.floor(Number(x) || 0), Math.floor(Number(y) || 0), Math.floor(Number(z) || 0));
  return { ok: true, v };
}

function _stats(name) {
  const s = _getStore(name);
  if (!s) return { ok: false, error: 'no such store' };
  const st = s.stats();
  return {
    ok: true,
    activeTileCount: st.activeTileCount,
    activeVoxelCount: st.activeVoxelCount,
    allocatedCells: st.allocatedCells,
    tileSize: st.tileSize,
    bounds: st.bounds,
  };
}

function _prune(name, threshold) {
  const s = _getStore(name);
  if (!s) return { ok: false, error: 'no such store' };
  const r = s.prune(threshold);
  return { ok: true, removed: r.removed, kept: r.kept };
}

function _clear(name) {
  const s = _getStore(name);
  if (!s) return { ok: false, error: 'no such store' };
  s.clear();
  return { ok: true };
}

function _list() {
  return { ok: true, names: Array.from(_vdbStores.keys()) };
}

function _forEachTile(name) {
  const s = _getStore(name);
  if (!s) return { ok: false, error: 'no such store' };
  const tiles = [];
  s.forEachActiveTile((t) => {
    tiles.push({ tx: t.tx, ty: t.ty, tz: t.tz, max: t.max, nonzero: t.nonzero });
  });
  return { ok: true, tiles };
}

export function installVDB() {
  if (_installed) return { ok: true, alreadyInstalled: true };
  _installed = true;

  const ops = {
    __studioVDBCreate: [
      (name, tileSize) => _create(name, tileSize),
      'Create a sparse VDB-style tile store (Houdini VDB / OpenVDB-style sparse grid).',
    ],
    __studioVDBSet: [
      (name, x, y, z, v) => _set(name, x, y, z, v),
      'Write a single voxel into a sparse VDB store; allocates the leaf tile on first nonzero write.',
    ],
    __studioVDBGet: [
      (name, x, y, z) => _get(name, x, y, z),
      'Read a single voxel from a sparse VDB store (returns 0 if the tile is not allocated).',
    ],
    __studioVDBStats: [
      (name) => _stats(name),
      'Read sparse VDB stats: active tile count, active voxel count, allocated cells, tile size, bounds.',
    ],
    __studioVDBPrune: [
      (name, threshold) => _prune(name, threshold),
      'Drop sparse VDB tiles whose per-tile |max| falls below threshold (returns removed/kept counts).',
    ],
    __studioVDBClear: [
      (name) => _clear(name),
      'Drop all tiles from a sparse VDB store.',
    ],
    __studioVDBList: [
      () => _list(),
      'List the names of all installed sparse VDB stores.',
    ],
    __studioVDBForEachTile: [
      (name) => _forEachTile(name),
      'Enumerate the active tiles of a sparse VDB store ({tx,ty,tz,max,nonzero}).',
    ],
  };

  registerOps(
    ops,
    'volume',
    'Sparse VDB-style tile bookkeeping (Houdini VDB / OpenVDB-style sparse grid).'
  );
  return { ok: true, alreadyInstalled: false, ops: Object.keys(ops).length };
}

// Internal handle for tests.
export function _peekStores() { return _vdbStores; }
