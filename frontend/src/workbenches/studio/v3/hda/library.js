// ArchDisc Studio V3 — HDA: library management.
//
// Thin wrappers around localStorage CRUD for `studio.v3.hda.*` keys.
//
// Public API:
//   listHDAs()           → { ok, count, hdas: [{ name, exposed, createdAt }, …] }
//   deleteHDA(name)      → { ok, deleted }
//   exportHDA(name)      → { ok, json } — JSON string suitable for download
//   importHDA(json)      → { ok, name } — accepts string or parsed object
//
// `listHDAs` filters localStorage keys by the slice's prefix so it
// won't trip over unrelated entries (e.g. slice-666 assets live under
// `studio.v3.assets.*`).
//
// All errors return `{ ok: false, error }` rather than throwing —
// these helpers are called from React event handlers + window globals
// where unhandled exceptions break the user's flow.

import {
  HDA_LS_PREFIX,
  HDA_VERSION,
  readRawAsset,
  writeRawAsset,
  deleteRawAsset,
} from './asset.js';

// ─── Listing ────────────────────────────────────────────────────────────

export function listHDAs() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ok: false, count: 0, hdas: [], error: 'no localStorage' };
  }
  const out = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(HDA_LS_PREFIX)) continue;
    const name = key.slice(HDA_LS_PREFIX.length);
    if (!name) continue;
    const raw = window.localStorage.getItem(key);
    if (!raw) continue;
    let parsed;
    try { parsed = JSON.parse(raw); } catch (_) { continue; }
    if (!parsed || !parsed.subgraph) continue;
    out.push({
      name,
      version: parsed.version || 0,
      exposed: Array.isArray(parsed.exposedParams)
        ? parsed.exposedParams.map((e) => e.key)
        : [],
      nodeCount: Array.isArray(parsed.subgraph.nodes) ? parsed.subgraph.nodes.length : 0,
      wireCount: Array.isArray(parsed.subgraph.wires) ? parsed.subgraph.wires.length : 0,
      createdAt: parsed.createdAt || null,
    });
  }
  // Sort alphabetically — matches slice-666 + slice-688 patterns.
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { ok: true, count: out.length, hdas: out };
}

// ─── Delete ─────────────────────────────────────────────────────────────

export function deleteHDA(name) {
  const clean = String(name || '').trim();
  if (!clean) return { ok: false, error: 'name required' };
  const existed = readRawAsset(clean);
  if (!existed) return { ok: false, error: 'unknown HDA: ' + clean };
  const did = deleteRawAsset(clean);
  return { ok: !!did, deleted: !!did, name: clean };
}

// ─── Export ─────────────────────────────────────────────────────────────

export function exportHDA(name) {
  const clean = String(name || '').trim();
  if (!clean) return { ok: false, error: 'name required' };
  const raw = readRawAsset(clean);
  if (!raw) return { ok: false, error: 'unknown HDA: ' + clean };
  // Re-serialise so the result is canonical (no localStorage formatting
  // quirks).
  try {
    const json = JSON.stringify(raw, null, 2);
    return { ok: true, name: clean, json, bytes: json.length };
  } catch (e) {
    return { ok: false, error: 'failed to serialise: ' + (e.message || e) };
  }
}

// ─── Import ─────────────────────────────────────────────────────────────

export function importHDA(jsonOrObject) {
  let asset;
  if (typeof jsonOrObject === 'string') {
    try { asset = JSON.parse(jsonOrObject); }
    catch (e) { return { ok: false, error: 'invalid JSON: ' + (e.message || e) }; }
  } else if (jsonOrObject && typeof jsonOrObject === 'object') {
    asset = jsonOrObject;
  } else {
    return { ok: false, error: 'importHDA: expected JSON string or object' };
  }

  if (!asset.name || typeof asset.name !== 'string') {
    return { ok: false, error: 'asset.name missing' };
  }
  if (!asset.subgraph || !Array.isArray(asset.subgraph.nodes)) {
    return { ok: false, error: 'asset.subgraph.nodes missing' };
  }
  // Stamp the version if absent.
  if (typeof asset.version !== 'number') asset.version = HDA_VERSION;
  if (!asset.createdAt) asset.createdAt = new Date().toISOString();
  if (!Array.isArray(asset.exposedParams)) asset.exposedParams = [];

  const ok = writeRawAsset(asset.name, asset);
  if (!ok) return { ok: false, error: 'localStorage write failed' };
  return {
    ok: true,
    name: asset.name,
    nodeCount: asset.subgraph.nodes.length,
    wireCount: Array.isArray(asset.subgraph.wires) ? asset.subgraph.wires.length : 0,
  };
}

// ─── Clear-all helper (used by tests + the dev-only "wipe library" path) ─

export function clearAllHDAs() {
  if (typeof window === 'undefined' || !window.localStorage) return 0;
  const doomed = [];
  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith(HDA_LS_PREFIX)) doomed.push(key);
  }
  for (const k of doomed) {
    try { window.localStorage.removeItem(k); } catch (_) {}
  }
  return doomed.length;
}
