// ArchDisc Studio V3 — geomdeep registration with the slice-684 editor.
//
// Two paths, tried in order:
//
//   1. If the slice-684 geomnodes editor exposed a public registrar
//      `window.__studioGeomRegisterNode(kind, def)`, call it for each
//      new kind. That installs the kind into the editor's NODE_KINDS
//      table so the editor's "+ Add" header row picks it up
//      automatically.
//
//   2. Otherwise, register every kind into `window.__studioGeomDeepNodes`
//      (a Map<kind, def>) AND expose a stand-alone applicator
//      `window.__studioGeomDeepApply(kind, params, inputs)` so power
//      users (and the e2e spec) can evaluate a deeper node kind without
//      the editor. The editor's next refresh / installer rev will pick
//      up `__studioGeomDeepNodes` if the team wires it in; until then
//      these kinds are reachable via the apply API.
//
// Either way we keep a parallel record on `window.__studioGeomDeepNodes`
// so introspection (`Object.keys(window.__studioGeomDeepNodes)`) always
// works regardless of whether the editor registrar exists.

import { MORE_NODE_KINDS, applyMoreKind } from './morenodes.js';

let _registered = false;

function getDeepMap() {
  if (typeof window === 'undefined') return null;
  if (!window.__studioGeomDeepNodes) {
    window.__studioGeomDeepNodes = {};
  }
  return window.__studioGeomDeepNodes;
}

// Returns { ok, registeredVia: 'editor'|'fallback', count }.
export function registerAllDeepKinds() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_registered) return { ok: true, already: true };
  _registered = true;

  const map = getDeepMap();
  const editorReg = (typeof window.__studioGeomRegisterNode === 'function')
    ? window.__studioGeomRegisterNode
    : null;

  let registeredVia = editorReg ? 'editor' : 'fallback';
  let count = 0;

  for (const [kind, def] of Object.entries(MORE_NODE_KINDS)) {
    // Always populate the fallback map so introspection works.
    map[kind] = def;

    if (editorReg) {
      try {
        const r = editorReg(kind, def);
        // If the editor returned a non-ok object we still keep the
        // fallback entry — both paths stay live.
        if (r && r.ok === false) registeredVia = 'fallback';
      } catch (_) {
        registeredVia = 'fallback';
      }
    }
    count++;
  }

  // Expose stand-alone applicator regardless of how registration went.
  window.__studioGeomDeepApply = (kind, params, inputs) => {
    try {
      const geo = applyMoreKind(kind, params || {}, inputs || {});
      const verts = (geo && geo.attributes && geo.attributes.position) ? geo.attributes.position.count : 0;
      return { ok: true, geometry: geo, vertices: verts };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  };

  return { ok: true, registeredVia, count };
}

export function unregisterAllDeepKinds() {
  if (typeof window === 'undefined') return { ok: true };
  _registered = false;
  try { delete window.__studioGeomDeepNodes; } catch (_) {}
  try { delete window.__studioGeomDeepApply; } catch (_) {}
  return { ok: true };
}

// Exposed for tests / debugging.
export function isRegistered() { return _registered; }
