// ArchDisc Studio V3 — geomtotal registration with the slice-684 editor.
//
// Same dual-path strategy as geomdeep/register.js:
//
//   1. If the slice-684 geomnodes editor exposed a public registrar
//      `window.__studioGeomRegisterNode(kind, def)`, call it for each
//      of the 30 new kinds. That installs them into the editor's
//      NODE_KINDS table so the editor's "+ Add" header row picks them
//      up automatically.
//
//   2. Otherwise, register every kind into `window.__studioGeomTotalNodes`
//      (a Map<kind, def>) AND expose a stand-alone applicator
//      `window.__studioGeomTotalApply(kind, params, inputs)` so power
//      users (and the e2e spec) can evaluate a geomtotal node kind
//      without the editor.
//
// Either way we keep a parallel record on `window.__studioGeomTotalNodes`
// so introspection (`Object.keys(window.__studioGeomTotalNodes)`) always
// works regardless of whether the editor registrar exists.

import { TOTAL_NODE_KINDS, applyTotalKind } from './nodes.js';

let _registered = false;

function getTotalMap() {
  if (typeof window === 'undefined') return null;
  if (!window.__studioGeomTotalNodes) {
    window.__studioGeomTotalNodes = {};
  }
  return window.__studioGeomTotalNodes;
}

// Returns { ok, registeredVia: 'editor'|'fallback', count }.
export function registerAllTotalKinds() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_registered) return { ok: true, already: true };
  _registered = true;

  const map = getTotalMap();
  const editorReg = (typeof window.__studioGeomRegisterNode === 'function')
    ? window.__studioGeomRegisterNode
    : null;

  let registeredVia = editorReg ? 'editor' : 'fallback';
  let count = 0;

  for (const [kind, def] of Object.entries(TOTAL_NODE_KINDS)) {
    // Always populate the fallback map so introspection works.
    map[kind] = def;

    if (editorReg) {
      try {
        const r = editorReg(kind, def);
        if (r && r.ok === false) registeredVia = 'fallback';
      } catch (_) {
        registeredVia = 'fallback';
      }
    }
    count++;
  }

  // Expose stand-alone applicator regardless of how registration went.
  window.__studioGeomTotalApply = (kind, params, inputs) => {
    try {
      const geo = applyTotalKind(kind, params || {}, inputs || {});
      const verts = (geo && geo.attributes && geo.attributes.position) ? geo.attributes.position.count : 0;
      return { ok: true, geometry: geo, vertices: verts };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  };

  return { ok: true, registeredVia, count };
}

export function unregisterAllTotalKinds() {
  if (typeof window === 'undefined') return { ok: true };
  _registered = false;
  try { delete window.__studioGeomTotalNodes; } catch (_) {}
  try { delete window.__studioGeomTotalApply; } catch (_) {}
  return { ok: true };
}

// Exposed for tests / debugging.
export function isRegistered() { return _registered; }
