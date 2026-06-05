// ArchDisc Studio V3 — geomdeep install entrypoint.
//
// `installGeomDeep()` is idempotent and:
//   1. Calls `registerAllDeepKinds()` (which either pushes the 20 new
//      kinds into the slice-684 editor's NODE_KINDS or stores them in
//      a fallback map; and also exposes __studioGeomDeepApply).
//   2. Installs 20 per-kind convenience ops on `window` named
//      `__studioGeomDeep_<kind>(params, inputs)`. Each calls
//      `__studioGeomDeepApply` and returns the result. These are
//      useful for the Archie tool-registry (slice 184) and ad-hoc
//      console debugging.
//   3. Registers every convenience op with the V3 command palette
//      under category 'geomnodes' so they show up in `/cmd` searches.
//
// The installer NEVER touches the slice-684 geomnodes graph instance
// or its editor mount — those are owned by geomnodes/index.js. We
// strictly layer on top.

import { MORE_NODE_KINDS, applyMoreKind, listMoreKinds } from './morenodes.js';
import { registerAllDeepKinds, unregisterAllDeepKinds } from './register.js';

let _installed = false;
let _convenienceOpNames = [];

export function installGeomDeep() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  // 1) Register the kinds with the editor (or fallback).
  const reg = registerAllDeepKinds();

  // 2) Install per-kind convenience ops.
  const opNames = [];
  for (const kind of listMoreKinds()) {
    const opName = `__studioGeomDeep_${kind}`;
    opNames.push(opName);
    // Closure-over-kind so each function is bound to the right kind.
    window[opName] = (params, inputs) => {
      try {
        const geo = applyMoreKind(kind, params || {}, inputs || {});
        const verts = (geo && geo.attributes && geo.attributes.position) ? geo.attributes.position.count : 0;
        const tris = (geo && geo.index) ? Math.floor(geo.index.count / 3) : Math.floor(verts / 3);
        return { ok: true, kind, geometry: geo, vertices: verts, triangles: tris };
      } catch (e) {
        return { ok: false, kind, error: e && e.message ? e.message : String(e) };
      }
    };
  }
  _convenienceOpNames = opNames;

  // Also expose a discovery surface: list all kinds + descriptors.
  window.__studioGeomDeepList = () => ({
    ok: true,
    count: opNames.length,
    registeredVia: reg.registeredVia || 'fallback',
    kinds: listMoreKinds().map((kind) => {
      const def = MORE_NODE_KINDS[kind];
      return {
        kind,
        title: def.title,
        category: def.category,
        inputs: def.inputs.map((i) => i.name),
        outputs: def.outputs.map((o) => o.name),
        defaultParams: def.defaultParams(),
      };
    }),
  });

  // 3) Register every op with the V3 command palette under 'geomnodes'.
  const palReg = window.__studioCommandRegister;
  if (typeof palReg === 'function') {
    const cat = 'geomnodes';
    for (const opName of opNames) {
      try {
        const kind = opName.replace(/^__studioGeomDeep_/, '');
        const def = MORE_NODE_KINDS[kind];
        const desc = def ? `Apply geom-deep node "${def.title}" (params, inputs)` : opName;
        palReg(opName, window[opName], { category: cat, description: desc });
      } catch (_) { /* swallow */ }
    }
    try {
      palReg('__studioGeomDeepApply', window.__studioGeomDeepApply, {
        category: cat,
        description: 'Apply any deep node kind by name (kind, params, inputs)',
      });
      palReg('__studioGeomDeepList', window.__studioGeomDeepList, {
        category: cat,
        description: 'List the 20 deeper geometry-node kinds added by geomdeep',
      });
    } catch (_) { /* swallow */ }
  }

  return {
    ok: true,
    ops: opNames.length,
    registeredVia: reg.registeredVia || 'fallback',
    kinds: listMoreKinds(),
  };
}

export function uninstallGeomDeep() {
  if (!_installed) return { ok: true };
  _installed = false;
  for (const opName of _convenienceOpNames) {
    try { delete window[opName]; } catch (_) {}
  }
  _convenienceOpNames = [];
  try { delete window.__studioGeomDeepList; } catch (_) {}
  unregisterAllDeepKinds();
  return { ok: true };
}

export function isInstalled() { return _installed; }
