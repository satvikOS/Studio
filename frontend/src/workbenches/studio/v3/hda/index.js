// ArchDisc Studio V3 — HDA installer.
//
// installHDA() is idempotent. It:
//   1. Pre-warms the manifold-3d module (RealBoolean's sync path).
//   2. Registers HDA's 15 new geometry-node kinds against the slice-684
//      editor (if it exposed `__studioGeomRegisterNode`) and ALWAYS
//      against the fallback map `window.__studioHDANodes` so
//      introspection works regardless.
//   3. Wires the full `__studioHDA*` op surface described in the brief:
//        Pack, Unpack, Instantiate, List, Delete, Export, Import,
//        per-kind `__studioHDA_<kind>` convenience ops,
//        PanelOpen / Close / Toggle.
//   4. Registers every op with the V3 command palette under category
//      'geomnodes' via common/registry.js.
//   5. Mounts the React HDA panel into a body-attached host so we
//      never touch StudioShellV3.jsx.

import React from 'react';
import {
  HDA_NODE_KINDS, applyHDAKind, listHDAKinds, ensureManifoldHot,
  realCSGAsync,
} from './nodes.js';
import { packAsset, unpackAsset } from './asset.js';
import { instantiate } from './instantiate.js';
import {
  listHDAs, deleteHDA, exportHDA, importHDA,
} from './library.js';
import HDAPanel from './HDAPanel.jsx';
import { mountPanel, unmountPanel } from '../common/panel.js';
import { registerOps, unregisterOps } from '../common/registry.js';

let _installed = false;
let _panel = null;
let _open = false;
let _refreshKey = 0;
let _convenienceOpNames = [];

// ─── Editor registration ────────────────────────────────────────────────
function registerKindsWithEditor() {
  if (typeof window === 'undefined') return { registeredVia: 'fallback', count: 0 };
  if (!window.__studioHDANodes) window.__studioHDANodes = {};
  const editorReg = (typeof window.__studioGeomRegisterNode === 'function')
    ? window.__studioGeomRegisterNode : null;
  let via = editorReg ? 'editor' : 'fallback';
  let count = 0;
  for (const [kind, def] of Object.entries(HDA_NODE_KINDS)) {
    window.__studioHDANodes[kind] = def;
    if (editorReg) {
      try {
        const r = editorReg(kind, def);
        if (r && r.ok === false) via = 'fallback';
      } catch (_) { via = 'fallback'; }
    }
    count++;
  }
  return { registeredVia: via, count };
}

// ─── Mount control ──────────────────────────────────────────────────────
function ensureHost() {
  if (_panel) return _panel.host;
  _panel = mountPanel('hda');
  return _panel ? _panel.host : null;
}

function render() {
  if (!_panel) return;
  if (!_open) { _panel.render(null); return; }
  _panel.render(
    React.createElement(HDAPanel, {
      listFn: listHDAs,
      deleteFn: (name) => {
        const r = deleteHDA(name);
        _refreshKey++;
        render();
        return r;
      },
      exportFn: exportHDA,
      importFn: (json) => {
        const r = importHDA(json);
        _refreshKey++;
        render();
        return r;
      },
      instantiateFn: (name, overrides) => instantiate(name, overrides),
      onCloseRequest: () => panelClose(),
      refreshKey: _refreshKey,
    }),
  );
}

function panelOpen() {
  ensureHost();
  _open = true;
  render();
  return { ok: true, open: true };
}

function panelClose() {
  _open = false;
  render();
  return { ok: true, open: false };
}

function panelToggle() {
  return _open ? panelClose() : panelOpen();
}

// ─── Per-kind convenience op factory ────────────────────────────────────
// Same shape as geomdeep / geomtotal: `(params, inputs) → { ok, geometry, vertices, triangles }`.
function makeKindOp(kind) {
  return (params, inputs) => {
    try {
      const geo = applyHDAKind(kind, params || {}, inputs || {});
      const verts = (geo && geo.attributes && geo.attributes.position)
        ? geo.attributes.position.count : 0;
      const tris = (geo && geo.index) ? Math.floor(geo.index.count / 3) : Math.floor(verts / 3);
      return { ok: true, kind, geometry: geo, vertices: verts, triangles: tris };
    } catch (e) {
      return { ok: false, kind, error: e && e.message ? e.message : String(e) };
    }
  };
}

// ─── Install ────────────────────────────────────────────────────────────
export function installHDA() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  // 1. Pre-warm manifold so RealBoolean's sync path lights up quickly.
  //    Swallow errors — fallback merge still works.
  try { ensureManifoldHot(); } catch (_) {}

  // 2. Register the 15 kinds with the slice-684 editor (or fallback).
  const reg = registerKindsWithEditor();

  // 3. Wire the bundle ops.
  window.__studioHDAPack = (name, subgraph, exposedParams) => {
    try {
      const r = packAsset(name, subgraph, exposedParams);
      _refreshKey++;
      render();
      return { ok: true, uuid: r.name, name: r.name, asset: r.asset };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  };
  window.__studioHDAUnpack = (name) => {
    const r = unpackAsset(name);
    if (!r.ok) return r;
    return { ok: true, name: r.name, subgraph: r.subgraph, exposedParams: r.exposedParams };
  };
  window.__studioHDAInstantiate = (name, paramOverrides) => {
    const r = instantiate(name, paramOverrides);
    return r;
  };
  window.__studioHDAList = () => {
    const r = listHDAs();
    return { ok: !!r.ok, count: r.count || 0, hdas: r.hdas || [] };
  };
  window.__studioHDADelete = (name) => {
    const r = deleteHDA(name);
    _refreshKey++;
    render();
    return r;
  };
  window.__studioHDAExport = (name) => exportHDA(name);
  window.__studioHDAImport = (jsonOrObject) => {
    const r = importHDA(jsonOrObject);
    _refreshKey++;
    render();
    return r;
  };

  // 4. Per-kind convenience ops.
  const opNames = [];
  for (const kind of listHDAKinds()) {
    const opName = '__studioHDA_' + kind;
    opNames.push(opName);
    window[opName] = makeKindOp(kind);
  }
  // Async real-CSG op for callers that want a guaranteed real boolean
  // regardless of WASM warm-up state.
  window.__studioHDA_realBooleanAsync = async (params, inputs) => {
    try {
      const A = inputs && inputs.A; const B = inputs && inputs.B;
      if (!A || !B) return { ok: false, error: 'need A and B' };
      const op = String((params && params.op) || 'union');
      const geo = await realCSGAsync(op, A, B);
      const verts = (geo && geo.attributes && geo.attributes.position)
        ? geo.attributes.position.count : 0;
      return { ok: true, geometry: geo, vertices: verts };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  };

  // Apply-by-name helper.
  window.__studioHDAApply = (kind, params, inputs) => {
    try {
      const geo = applyHDAKind(kind, params || {}, inputs || {});
      const verts = (geo && geo.attributes && geo.attributes.position)
        ? geo.attributes.position.count : 0;
      return { ok: true, geometry: geo, vertices: verts };
    } catch (e) {
      return { ok: false, error: e && e.message ? e.message : String(e) };
    }
  };

  // Discovery surface.
  window.__studioHDAListKinds = () => ({
    ok: true,
    count: opNames.length,
    registeredVia: reg.registeredVia,
    kinds: listHDAKinds().map((kind) => {
      const def = HDA_NODE_KINDS[kind];
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

  _convenienceOpNames = opNames;

  // 5. Panel toggles.
  window.__studioHDAPanelOpen = panelOpen;
  window.__studioHDAPanelClose = panelClose;
  window.__studioHDAPanelToggle = panelToggle;

  // 6. Esc closes the panel.
  const onKey = (e) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.key === 'Escape' && _open) { panelClose(); e.preventDefault(); }
  };
  window.addEventListener('keydown', onKey);

  // 7. Command palette — every op under 'geomnodes' so /cmd discovers them.
  const opMap = {
    __studioHDAPack:           [window.__studioHDAPack,           'Pack a node sub-graph as a named HDA (name, subgraph, exposedParams)'],
    __studioHDAUnpack:         [window.__studioHDAUnpack,         'Unpack an HDA by name (returns subgraph + exposedParams)'],
    __studioHDAInstantiate:    [window.__studioHDAInstantiate,    'Evaluate an HDA with param overrides + add a fresh Mesh to the scene'],
    __studioHDAList:           [window.__studioHDAList,           'List every HDA saved in localStorage'],
    __studioHDADelete:         [window.__studioHDADelete,         'Delete an HDA by name'],
    __studioHDAExport:         [window.__studioHDAExport,         'Export an HDA as a JSON string'],
    __studioHDAImport:         [window.__studioHDAImport,         'Import an HDA JSON string or object'],
    __studioHDAApply:          [window.__studioHDAApply,          'Apply an HDA kind by name (kind, params, inputs)'],
    __studioHDAListKinds:      [window.__studioHDAListKinds,      'List the 15 HDA geometry-node kinds'],
    __studioHDAPanelOpen:      [window.__studioHDAPanelOpen,      'Open the HDA library panel'],
    __studioHDAPanelClose:     [window.__studioHDAPanelClose,     'Close the HDA library panel'],
    __studioHDAPanelToggle:    [window.__studioHDAPanelToggle,    'Toggle the HDA library panel'],
    __studioHDA_realBooleanAsync: [window.__studioHDA_realBooleanAsync, 'Async real-CSG boolean (awaits manifold-3d)'],
  };
  // Per-kind ops.
  for (const opName of opNames) {
    const kind = opName.replace(/^__studioHDA_/, '');
    const def = HDA_NODE_KINDS[kind];
    const desc = def ? `Apply HDA node "${def.title}" (params, inputs)` : opName;
    opMap[opName] = [window[opName], desc];
  }
  registerOps(opMap, 'geomnodes');

  return {
    ok: true,
    kinds: opNames.length,
    ops: Object.keys(opMap).length,
    registeredVia: reg.registeredVia,
  };
}

// ─── Uninstall (for tests / hot-reload) ─────────────────────────────────
export function uninstallHDA() {
  if (!_installed) return { ok: true };
  _installed = false;
  const names = [
    '__studioHDAPack', '__studioHDAUnpack', '__studioHDAInstantiate',
    '__studioHDAList', '__studioHDADelete', '__studioHDAExport', '__studioHDAImport',
    '__studioHDAApply', '__studioHDAListKinds',
    '__studioHDAPanelOpen', '__studioHDAPanelClose', '__studioHDAPanelToggle',
    '__studioHDA_realBooleanAsync',
    ..._convenienceOpNames,
  ];
  unregisterOps(names);
  for (const n of names) { try { delete window[n]; } catch (_) {} }
  if (_panel) { unmountPanel('hda'); _panel = null; }
  _open = false;
  _convenienceOpNames = [];
  try { delete window.__studioHDANodes; } catch (_) {}
  try { delete window.__studioHDAManifoldSync; } catch (_) {}
  return { ok: true };
}

export function isInstalled() { return _installed; }
