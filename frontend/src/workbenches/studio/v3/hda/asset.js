// ArchDisc Studio V3 — HDA: Houdini Digital Asset analog.
//
// An HDA is a packaged sub-graph of geometry nodes plus a declared
// list of "exposed parameters" — name / path pairs that callers can
// override at instantiate-time without touching the internal graph.
//
// Storage: localStorage under `studio.v3.hda.<name>`.
//
// On-disk schema (JSON):
//   {
//     version       : 1,
//     name          : 'BrickWall',
//     createdAt     : ISO timestamp,
//     subgraph      : {
//       nodes : [{ id, kind, params, x, y }],
//       wires : [{ srcId, srcOut, dstId, dstIn }],
//     },
//     exposedParams : [
//       { key: 'wallHeight', nodeId: 'gn_1', param: 'sizeY' },
//       { key: 'brickHue',   nodeId: 'gn_3', param: 'color' },
//     ],
//   }
//
// `packAsset` accepts any of:
//   • a serialised slice-684 graph (`{ version, nodes, wires }`)
//   • a Map<id, node> + flat wires list (raw editor state)
//   • an array of node objects (we infer a trivial linear wiring)
//
// `unpackAsset` returns the same `{ nodes, wires }` shape so the
// caller can hand it straight back to `fromJSON(graph)`.
//
// Per the brief — pure native; no extra deps; no WASM.

const LS_PREFIX = 'studio.v3.hda.';
export const HDA_LS_PREFIX = LS_PREFIX;
export const HDA_VERSION = 1;

// ─── Validation / sanitisation ──────────────────────────────────────────

// Strip Map / Set instances out of a node graph and freeze it into pure
// JSON. Symbols & functions are dropped. We do this on pack so the
// localStorage payload is forward-compatible.
function _cloneJSONSafe(obj) {
  return JSON.parse(JSON.stringify(obj));
}

// Coerce a sub-graph value into the canonical `{ nodes, wires }` shape.
function _normaliseSubgraph(subgraph) {
  if (!subgraph) throw new Error('packAsset: subgraph is required');
  // Array of node descriptors → infer linear wiring.
  if (Array.isArray(subgraph)) {
    const nodes = subgraph.map((n, i) => ({
      id: n.id || `hda_${i}_${Math.random().toString(36).slice(2, 7)}`,
      kind: n.kind,
      params: n.params || {},
      x: +n.x || (i * 200),
      y: +n.y || 120,
    }));
    const wires = [];
    for (let i = 0; i < nodes.length - 1; i++) {
      wires.push({
        srcId: nodes[i].id, srcOut: 'geometry',
        dstId: nodes[i + 1].id, dstIn: 'geometry',
      });
    }
    return { nodes, wires };
  }
  // Map<id, node> → flatten.
  if (subgraph.nodes && subgraph.nodes instanceof Map) {
    const arr = Array.from(subgraph.nodes.values()).map((n) => ({
      id: n.id, kind: n.kind, params: n.params, x: n.x, y: n.y,
    }));
    const wires = Array.isArray(subgraph.wires) ? subgraph.wires.slice() : [];
    return { nodes: arr, wires };
  }
  // Plain `{ nodes: [...], wires: [...] }`.
  if (Array.isArray(subgraph.nodes)) {
    return {
      nodes: subgraph.nodes.map((n) => ({
        id: n.id, kind: n.kind, params: n.params || {}, x: +n.x || 0, y: +n.y || 0,
      })),
      wires: Array.isArray(subgraph.wires) ? subgraph.wires.slice() : [],
    };
  }
  throw new Error('packAsset: unrecognised subgraph shape');
}

// Validate `exposedParams` — each entry must have { key, nodeId, param }
// and refer to a node present in the sub-graph.
function _normaliseExposed(exposedParams, nodes) {
  if (!exposedParams) return [];
  if (!Array.isArray(exposedParams)) {
    throw new Error('packAsset: exposedParams must be an array');
  }
  const known = new Set(nodes.map((n) => n.id));
  const out = [];
  for (const e of exposedParams) {
    if (!e) continue;
    if (typeof e !== 'object') continue;
    const key = String(e.key || e.name || '');
    const nodeId = String(e.nodeId || e.node || '');
    const param = String(e.param || e.path || '');
    if (!key || !nodeId || !param) continue;
    if (!known.has(nodeId)) continue;
    out.push({ key, nodeId, param });
  }
  return out;
}

// ─── Pack / Unpack ──────────────────────────────────────────────────────

/**
 * packAsset(name, subgraph, exposedParams) → asset JSON object.
 *
 * Also writes the serialised JSON to localStorage under
 * `studio.v3.hda.<name>`. If `name` clashes with an existing HDA the
 * previous entry is OVERWRITTEN (consistent with slice-666 assets).
 *
 * Returns `{ ok: true, name, asset }` on success. `asset` is the JSON
 * payload (handy for in-memory chaining without re-reading localStorage).
 *
 * Throws on invalid arguments — let the caller catch + surface.
 */
export function packAsset(name, subgraph, exposedParams) {
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('packAsset: name is required');
  const normSub = _normaliseSubgraph(subgraph);
  const normExposed = _normaliseExposed(exposedParams, normSub.nodes);
  const asset = {
    version: HDA_VERSION,
    name: cleanName,
    createdAt: new Date().toISOString(),
    subgraph: _cloneJSONSafe(normSub),
    exposedParams: _cloneJSONSafe(normExposed),
  };
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(LS_PREFIX + cleanName, JSON.stringify(asset));
    } catch (e) {
      // Swallow quota errors — the in-memory return is still useful.
    }
  }
  return { ok: true, name: cleanName, asset };
}

/**
 * unpackAsset(name OR assetJson) → { ok, subgraph, exposedParams }.
 *
 * If the argument is a string we read from localStorage; if it's an
 * object we treat it as an already-parsed asset (handy after Import).
 *
 * Returns `{ ok: false, error }` if the name is unknown / payload bad.
 */
export function unpackAsset(nameOrAsset) {
  let asset = null;
  if (typeof nameOrAsset === 'string') {
    if (typeof window === 'undefined' || !window.localStorage) {
      return { ok: false, error: 'no localStorage' };
    }
    const raw = window.localStorage.getItem(LS_PREFIX + nameOrAsset);
    if (!raw) return { ok: false, error: 'unknown HDA: ' + nameOrAsset };
    try { asset = JSON.parse(raw); }
    catch (e) { return { ok: false, error: 'corrupted HDA JSON' }; }
  } else if (nameOrAsset && typeof nameOrAsset === 'object') {
    asset = nameOrAsset;
  } else {
    return { ok: false, error: 'unpackAsset: name or asset required' };
  }
  if (!asset.subgraph || !Array.isArray(asset.subgraph.nodes)) {
    return { ok: false, error: 'asset has no subgraph.nodes' };
  }
  return {
    ok: true,
    name: asset.name || '',
    version: asset.version || 0,
    subgraph: {
      nodes: asset.subgraph.nodes.map((n) => ({
        id: n.id, kind: n.kind, params: n.params || {}, x: +n.x || 0, y: +n.y || 0,
      })),
      wires: Array.isArray(asset.subgraph.wires) ? asset.subgraph.wires.slice() : [],
    },
    exposedParams: Array.isArray(asset.exposedParams) ? asset.exposedParams.slice() : [],
  };
}

// Read the raw stored JSON for `name` — used by library export / panel.
export function readRawAsset(name) {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  const raw = window.localStorage.getItem(LS_PREFIX + name);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (_) { return null; }
}

// Write an already-validated asset JSON to localStorage (used by import).
export function writeRawAsset(name, asset) {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    window.localStorage.setItem(LS_PREFIX + name, JSON.stringify(asset));
    return true;
  } catch (_) { return false; }
}

// Delete an asset by name.
export function deleteRawAsset(name) {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    window.localStorage.removeItem(LS_PREFIX + name);
    return true;
  } catch (_) { return false; }
}

// Apply `paramOverrides` to a copy of the sub-graph based on the
// `exposedParams` mapping. Returns a fresh `{ nodes, wires }` object;
// the input is not mutated.
export function applyOverrides(subgraph, exposedParams, paramOverrides) {
  if (!paramOverrides || typeof paramOverrides !== 'object') {
    return _cloneJSONSafe(subgraph);
  }
  if (!Array.isArray(exposedParams) || exposedParams.length === 0) {
    return _cloneJSONSafe(subgraph);
  }
  const out = _cloneJSONSafe(subgraph);
  const byId = new Map(out.nodes.map((n) => [n.id, n]));
  for (const ex of exposedParams) {
    if (!ex || !(ex.key in paramOverrides)) continue;
    const node = byId.get(ex.nodeId);
    if (!node) continue;
    node.params = node.params || {};
    node.params[ex.param] = paramOverrides[ex.key];
  }
  return out;
}
