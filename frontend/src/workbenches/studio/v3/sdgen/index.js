// ArchDisc Studio V3 — Substance Designer noise generators + filters (slice 775).
//
// `installSDGen()` installs the public window surface:
//
//   __studioSDGenListGenerators()                       → {ok, names:string[]}
//   __studioSDGenListFilters()                          → {ok, names:string[]}
//   __studioSDGenCreate({generator, params, seed})      → {ok, key, samples}
//   __studioSDGenApplyFilter({key, filter, params})     → {ok, key, samples}
//   __studioSDGenExportCanvasTexture({key, size})       → {ok, dataUrl}
//   __studioSDGenList()                                 → {ok, keys:string[], items:[…]}
//   __studioSDGenDelete({key})                          → {ok}
//
// Buffers are kept in an in-process Map keyed by a small sequence id. The
// `samples` field returned by Create / ApplyFilter is a 10×10 grid sampled
// from the underlying Float32Array — small enough to ship cheaply across
// `win.evaluate()` in e2e specs but rich enough to assert range / variance
// drops after a blur pass.
//
// Pure JS, three.js only (used by ExportCanvasTexture). No new deps.

import * as THREE from 'three';
import { registerOps, unregisterOps } from '../common/registry.js';
import { GENERATORS, GENERATOR_NAMES } from './generators.js';
import { FILTERS, FILTER_NAMES } from './filters.js';

const _buffers = new Map(); // key → { buf, size, generator, history: [{kind, name, params}] }
let _seq = 1;
function _uid() { return `sdgen-${_seq++}`; }

function _samples(buf, size) {
  // 10×10 evenly-spaced grid sampled from the source buffer.
  const grid = 10;
  const out = [];
  for (let gy = 0; gy < grid; gy++) {
    const row = [];
    for (let gx = 0; gx < grid; gx++) {
      const sx = Math.min(size - 1, Math.floor((gx + 0.5) / grid * size));
      const sy = Math.min(size - 1, Math.floor((gy + 0.5) / grid * size));
      row.push(+buf[sy * size + sx].toFixed(6));
    }
    out.push(row);
  }
  return out;
}

// ─── Op implementations ──────────────────────────────────────────────────
function listGenerators() {
  return { ok: true, names: GENERATOR_NAMES.slice(), count: GENERATOR_NAMES.length };
}

function listFilters() {
  return { ok: true, names: FILTER_NAMES.slice(), count: FILTER_NAMES.length };
}

function _sizeFromParams(params) {
  const s = Number(params?.size) || 256;
  return Math.max(8, Math.min(1024, s));
}

function createOp(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const name = String(a.generator || '');
  const fn = GENERATORS[name];
  if (!fn) return { ok: false, error: `unknown generator: ${name || '∅'}` };
  const params = a.params || {};
  const seed = Number.isFinite(+a.seed) ? +a.seed : 42;
  const size = _sizeFromParams(params);
  const buf = fn({ ...params, size }, seed);
  const key = _uid();
  _buffers.set(key, {
    buf, size, generator: name,
    history: [{ kind: 'generator', name, params: { ...params, size }, seed }],
  });
  return { ok: true, key, generator: name, size, samples: _samples(buf, size) };
}

function applyFilterOp(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const key = String(a.key || '');
  const entry = _buffers.get(key);
  if (!entry) return { ok: false, error: `unknown key: ${key || '∅'}` };
  const name = String(a.filter || '');
  const fn = FILTERS[name];
  if (!fn) return { ok: false, error: `unknown filter: ${name || '∅'}` };
  const params = a.params || {};
  const out = fn(entry.buf, params);
  // Some filters (hsv with rgb=true) widen to RGB; keep size from the
  // generator if the output length still matches size × size, otherwise
  // refuse to install it as the canonical buffer.
  const expected = entry.size * entry.size;
  if (out.length !== expected) {
    return {
      ok: true, key, filter: name,
      wide: true, samples: null,
      note: 'wide output not stored; use ExportCanvasTexture immediately',
    };
  }
  entry.buf = out;
  entry.history.push({ kind: 'filter', name, params });
  return { ok: true, key, filter: name, samples: _samples(out, entry.size) };
}

function exportCanvasTextureOp(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const key = String(a.key || '');
  const entry = _buffers.get(key);
  if (!entry) return { ok: false, error: `unknown key: ${key || '∅'}` };
  if (typeof document === 'undefined') return { ok: false, error: 'no document' };
  const exportSize = Math.max(8, Math.min(1024, Number(a.size) || entry.size));
  const cv = document.createElement('canvas');
  cv.width = exportSize; cv.height = exportSize;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(exportSize, exportSize);
  // Nearest-neighbour resample.
  for (let y = 0; y < exportSize; y++) {
    const sy = Math.min(entry.size - 1, Math.floor(y / exportSize * entry.size));
    for (let x = 0; x < exportSize; x++) {
      const sx = Math.min(entry.size - 1, Math.floor(x / exportSize * entry.size));
      const v = entry.buf[sy * entry.size + sx];
      const c = Math.max(0, Math.min(255, Math.round(v * 255)));
      const i = (y * exportSize + x) * 4;
      img.data[i] = c; img.data[i + 1] = c; img.data[i + 2] = c; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // Build a CanvasTexture so callers that want the real Three.js object
  // can grab it via window.__studioSDGenLastTexture; the data URL is the
  // shippable payload across e2e boundaries.
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  if (typeof window !== 'undefined') window.__studioSDGenLastTexture = tex;
  const dataUrl = cv.toDataURL('image/png');
  return { ok: true, key, size: exportSize, dataUrl };
}

function listOp() {
  const items = [];
  for (const [key, entry] of _buffers.entries()) {
    items.push({
      key, generator: entry.generator, size: entry.size,
      historyLength: entry.history.length,
    });
  }
  return { ok: true, count: items.length, keys: items.map((i) => i.key), items };
}

function deleteOp(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const key = String(a.key || '');
  const had = _buffers.delete(key);
  return { ok: true, deleted: had };
}

// Internal accessor used by e2e specs that want the raw buffer for
// variance asserts.
function _bufferOp(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const entry = _buffers.get(String(a.key || ''));
  if (!entry) return { ok: false, error: 'unknown key' };
  return {
    ok: true,
    size: entry.size,
    length: entry.buf.length,
    array: Array.from(entry.buf),
  };
}

// ─── Install ─────────────────────────────────────────────────────────────
let _installed = false;

export function installSDGen() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioSDGenInstalled) {
    return { ok: true, already: true,
      generators: GENERATOR_NAMES.length, filters: FILTER_NAMES.length };
  }
  _installed = true;
  window.__studioSDGenInstalled = true;

  registerOps({
    __studioSDGenListGenerators: [listGenerators,
      'Substance Designer noise generators — list 12 procedural noise generator names.'],
    __studioSDGenListFilters: [listFilters,
      'Substance Designer noise filters — list 8 procedural image filter names.'],
    __studioSDGenCreate: [createOp,
      'Substance Designer noise — create a buffer from {generator, params, seed}; returns {key, samples 10×10}.'],
    __studioSDGenApplyFilter: [applyFilterOp,
      'Substance Designer noise — apply a filter to an existing buffer key.'],
    __studioSDGenExportCanvasTexture: [exportCanvasTextureOp,
      'Substance Designer noise — convert the buffer to a Three.js CanvasTexture and return its dataURL.'],
    __studioSDGenList: [listOp,
      'Substance Designer noise — list all stored buffers with their generator + history length.'],
    __studioSDGenDelete: [deleteOp,
      'Substance Designer noise — release the buffer at {key}.'],
    __studioSDGenBuffer: [_bufferOp,
      'Substance Designer noise — read the raw Float32Array (debug / e2e).'],
  }, 'matlib', 'Substance Designer noise generators + filters (slice 775).');

  return {
    ok: true,
    generators: GENERATOR_NAMES.length,
    filters: FILTER_NAMES.length,
  };
}

export function uninstallSDGen() {
  if (!_installed) return { ok: true };
  unregisterOps([
    '__studioSDGenListGenerators', '__studioSDGenListFilters',
    '__studioSDGenCreate', '__studioSDGenApplyFilter',
    '__studioSDGenExportCanvasTexture',
    '__studioSDGenList', '__studioSDGenDelete', '__studioSDGenBuffer',
  ]);
  _installed = false;
  if (typeof window !== 'undefined') window.__studioSDGenInstalled = false;
  _buffers.clear();
  return { ok: true };
}

export default installSDGen;
