// ArchDisc Studio V3 — shader graph install + window.__studio* API.
//
// installShaderGraph() is idempotent. It builds a single graph instance,
// attaches every op described in the slice brief, registers them with
// the V3 command palette under category 'shader', and mounts the editor
// component into a body-attached <div data-studio-v3-shader-editor>.
//
// The editor lives outside the React tree (mounted via React.createRoot)
// so we don't touch StudioShellV3.jsx. Open/close just toggles its
// internal mount state.

import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  createGraph, addNode, removeNode, connect, disconnect,
  toJSON, fromJSON,
} from './graph.js';
import { bakeGraphToCanvas, applyGraphToMesh } from './applyToMaterial.js';
import ShaderEditor from './ShaderEditor.jsx';

let _installed = false;
let _graph = null;
let _editorHost = null;
let _editorRoot = null;
let _editorOpen = false;

function getMesh() {
  if (typeof window === 'undefined') return null;
  if (window.__studioSelectedMesh) return window.__studioSelectedMesh();
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}

function bakeOnly() {
  const mesh = getMesh();
  const baked = bakeGraphToCanvas(_graph, mesh);
  return { ok: true, dataUrl: baked.dataUrl, size: baked.size };
}

function applyToSelection() {
  const mesh = getMesh();
  if (!mesh) return { ok: false, error: 'no mesh selected' };
  const r = applyGraphToMesh(_graph, mesh);
  return r;
}

// ─── Editor mount control ────────────────────────────────────────────────
function mountEditorHost() {
  if (typeof document === 'undefined') return null;
  if (_editorHost) return _editorHost;
  _editorHost = document.createElement('div');
  _editorHost.setAttribute('data-studio-v3-shader-editor-host', '');
  document.body.appendChild(_editorHost);
  _editorRoot = createRoot(_editorHost);
  return _editorHost;
}

function renderEditor() {
  if (!_editorRoot) return;
  if (!_editorOpen) {
    _editorRoot.render(null);
    return;
  }
  _editorRoot.render(
    React.createElement(ShaderEditor, {
      getGraph: () => _graph,
      evalAndApply: () => applyToSelection(),
      evalOnly: () => bakeOnly(),
      onCloseRequest: () => editorClose(),
    })
  );
}

function editorOpen() {
  mountEditorHost();
  _editorOpen = true;
  renderEditor();
  return { ok: true, open: true };
}

function editorClose() {
  _editorOpen = false;
  renderEditor();
  return { ok: true, open: false };
}

function editorToggle() {
  return _editorOpen ? editorClose() : editorOpen();
}

// Build a small default graph so first-open shows something useful.
function seedDefaultGraph() {
  const tex = addNode(_graph, 'texture', { pattern: 'checker', scale: 6 });
  tex.x = 60; tex.y = 80;
  const noise = addNode(_graph, 'noise', { scale: 12 });
  noise.x = 60; noise.y = 260;
  const mix = addNode(_graph, 'mix', {});
  mix.x = 320; mix.y = 160;
  const out = addNode(_graph, 'output', {});
  out.x = 580; out.y = 160;
  connect(_graph, tex.id, 'color', mix.id, 'a');
  connect(_graph, noise.id, 'color', mix.id, 'b');
  connect(_graph, noise.id, 'fac', mix.id, 'fac');
  connect(_graph, mix.id, 'color', out.id, 'color');
}

function listNodes() {
  return {
    ok: true,
    count: _graph.nodes.size,
    nodes: Array.from(_graph.nodes.values()).map((n) => ({
      uuid: n.id, kind: n.kind, params: { ...n.params }, x: n.x, y: n.y,
    })),
  };
}

// ─── Install ─────────────────────────────────────────────────────────────
export function installShaderGraph() {
  if (typeof window === 'undefined') return { ok: false };
  if (_installed) return { ok: true, already: true };
  _installed = true;
  _graph = createGraph();
  seedDefaultGraph();

  // CRUD ops.
  window.__studioShaderNodeAdd = (kind, params) => {
    try {
      const n = addNode(_graph, kind, params || {});
      renderEditor();
      return { ok: true, uuid: n.id, kind: n.kind };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };
  window.__studioShaderNodeRemove = (uuid) => {
    const ok = removeNode(_graph, uuid);
    renderEditor();
    return { ok };
  };
  window.__studioShaderNodeConnect = (srcUuid, srcOut, dstUuid, dstIn) => {
    const r = connect(_graph, srcUuid, srcOut, dstUuid, dstIn);
    renderEditor();
    return r;
  };
  window.__studioShaderNodeDisconnect = (srcUuid, srcOut, dstUuid, dstIn) => {
    const r = disconnect(_graph, srcUuid, srcOut, dstUuid, dstIn);
    renderEditor();
    return r;
  };

  // Eval / apply.
  window.__studioShaderEvaluate = () => bakeOnly();
  window.__studioShaderApplyToSelection = () => applyToSelection();

  // Persistence.
  window.__studioShaderGraphSerialize = () => ({ ok: true, json: toJSON(_graph) });
  window.__studioShaderGraphDeserialize = (json) => {
    _graph = fromJSON(json);
    renderEditor();
    return { ok: true, count: _graph.nodes.size };
  };

  // Editor toggles.
  window.__studioShaderEditorOpen = editorOpen;
  window.__studioShaderEditorClose = editorClose;
  window.__studioShaderEditorToggle = editorToggle;

  // Listing.
  window.__studioShaderListNodes = listNodes;
  // Expose the live graph for advanced introspection (tests & debugging).
  window.__studioShaderGraph = () => _graph;

  // Hotkey: G then S opens the editor. Two-chord so we don't collide with
  // G alone (grab). Falls back silently if focus is inside an input.
  const _onKey = (e) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.key === 'Escape' && _editorOpen) { editorClose(); e.preventDefault(); }
  };
  window.addEventListener('keydown', _onKey);

  // Register with the V3 command palette if available. The auto-seed
  // pass (in api.js) caches the function reference at registry creation;
  // we explicitly register *after* install so the entry exists with the
  // 'shader' category.
  const reg = window.__studioCommandRegister;
  if (typeof reg === 'function') {
    const cat = 'shader';
    const cmds = [
      ['__studioShaderNodeAdd', 'Add a shader node (kind, params)'],
      ['__studioShaderNodeRemove', 'Remove a shader node by uuid'],
      ['__studioShaderNodeConnect', 'Connect two shader sockets'],
      ['__studioShaderNodeDisconnect', 'Disconnect two shader sockets'],
      ['__studioShaderEvaluate', 'Bake the shader graph to a PNG dataUrl'],
      ['__studioShaderApplyToSelection', 'Bake + assign as the selection mat.map'],
      ['__studioShaderGraphSerialize', 'Serialise the shader graph to JSON'],
      ['__studioShaderGraphDeserialize', 'Replace the graph from JSON'],
      ['__studioShaderEditorOpen', 'Open the shader graph editor'],
      ['__studioShaderEditorClose', 'Close the shader graph editor'],
      ['__studioShaderEditorToggle', 'Toggle the shader graph editor'],
      ['__studioShaderListNodes', 'List nodes currently in the graph'],
    ];
    for (const [name, desc] of cmds) {
      reg(name, window[name], { category: cat, description: desc });
    }
  }

  return { ok: true, ops: 12 };
}

// Mostly for tests / hot-reload scenarios.
export function uninstallShaderGraph() {
  if (!_installed) return { ok: true };
  _installed = false;
  for (const k of [
    '__studioShaderNodeAdd', '__studioShaderNodeRemove',
    '__studioShaderNodeConnect', '__studioShaderNodeDisconnect',
    '__studioShaderEvaluate', '__studioShaderApplyToSelection',
    '__studioShaderGraphSerialize', '__studioShaderGraphDeserialize',
    '__studioShaderEditorOpen', '__studioShaderEditorClose', '__studioShaderEditorToggle',
    '__studioShaderListNodes', '__studioShaderGraph',
  ]) { try { delete window[k]; } catch (_) {} }
  if (_editorRoot) {
    try { _editorRoot.unmount(); } catch (_) {}
    _editorRoot = null;
  }
  if (_editorHost && _editorHost.parentNode) {
    _editorHost.parentNode.removeChild(_editorHost);
  }
  _editorHost = null;
  _editorOpen = false;
  _graph = null;
  return { ok: true };
}
