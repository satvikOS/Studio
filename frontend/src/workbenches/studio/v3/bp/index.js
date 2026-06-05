// ArchDisc Studio V3 — Blueprints install + window.__studioBP* surface.
//
// installBlueprints() is idempotent. It owns one shared graph + one
// runtime instance, mounts the SVG editor on demand into a body-attached
// host, and registers every op with the V3 command palette under
// category 'bp'.
//
// Pattern mirrors shader/index.js — the editor lives outside the React
// tree (createRoot into a body div) so we never touch StudioShellV3.jsx.

import React from 'react';
import {
  createGraph, addNode, removeNode,
  connectExec, connectData, disconnect,
  toJSON, fromJSON,
} from './graph.js';
import { createRuntime } from './runtime.js';
import BPEditor from './BPEditor.jsx';
import { mountPanel, unmountPanel } from '../common/panel.js';
import { registerOps, unregisterOps } from '../common/registry.js';

let _installed = false;
let _graph = null;
let _runtime = null;
let _panel = null;
let _editorOpen = false;
let _escListener = null;

// ─── Editor mount control ────────────────────────────────────────────────
function renderEditor() {
  if (!_panel) return;
  if (!_editorOpen) { _panel.render(null); return; }
  _panel.render(
    React.createElement(BPEditor, {
      getGraph: () => _graph,
      onCloseRequest: () => editorClose(),
      onRunStart: () => runtimeStart(),
      onRunStop: () => runtimeStop(),
      isRunning: !!(_runtime && _runtime.started),
    })
  );
}

function editorOpen() {
  if (!_panel) _panel = mountPanel('bp-editor');
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

// ─── Runtime control ─────────────────────────────────────────────────────
function runtimeStart() {
  if (!_runtime) _runtime = createRuntime(_graph);
  _runtime.setGraph(_graph);
  const r = _runtime.start();
  renderEditor();
  return r;
}
function runtimeStop() {
  if (!_runtime) return { ok: true };
  const r = _runtime.stop();
  renderEditor();
  return r;
}

// ─── Default seed graph (handy for first-open). ──────────────────────────
function seedDefaultGraph() {
  // OnStart → Log("hello")
  const onStart = addNode(_graph, 'OnStart', {});
  onStart.x = 60; onStart.y = 80;
  const log = addNode(_graph, 'Log', { message: 'OnStart fired' });
  log.x = 320; log.y = 80;
  connectExec(_graph, onStart.id, 'then', log.id, 'exec');

  // OnTick → Log("tick")
  const onTick = addNode(_graph, 'OnTick', {});
  onTick.x = 60; onTick.y = 240;
  const log2 = addNode(_graph, 'Log', { message: 'tick' });
  log2.x = 320; log2.y = 240;
  connectExec(_graph, onTick.id, 'then', log2.id, 'exec');
}

function listNodes() {
  return {
    ok: true,
    count: _graph.nodes.size,
    nodes: Array.from(_graph.nodes.values()).map((n) => ({
      uuid: n.id, kind: n.kind, params: { ...n.params }, x: n.x, y: n.y,
    })),
    wires: _graph.wires.slice(),
  };
}

// ─── Install ─────────────────────────────────────────────────────────────
export function installBlueprints() {
  if (typeof window === 'undefined') return { ok: false };
  if (_installed) return { ok: true, already: true };
  _installed = true;
  _graph = createGraph();
  seedDefaultGraph();
  _runtime = createRuntime(_graph);

  // ── CRUD ──
  window.__studioBPNodeAdd = (kind, params) => {
    try {
      const n = addNode(_graph, kind, params || {});
      renderEditor();
      return { ok: true, uuid: n.id, kind: n.kind };
    } catch (e) { return { ok: false, error: e && e.message }; }
  };
  window.__studioBPNodeRemove = (uuid) => {
    const ok = removeNode(_graph, uuid);
    renderEditor();
    return { ok };
  };

  // ── Wires ──
  window.__studioBPConnectExec = (srcUuid, srcOut, dstUuid, dstIn) => {
    const r = connectExec(_graph, srcUuid, srcOut, dstUuid, dstIn);
    renderEditor();
    return r;
  };
  window.__studioBPConnectData = (srcUuid, srcOut, dstUuid, dstIn) => {
    const r = connectData(_graph, srcUuid, srcOut, dstUuid, dstIn);
    renderEditor();
    return r;
  };
  window.__studioBPDisconnect = (srcUuid, srcOut, dstUuid, dstIn) => {
    const r = disconnect(_graph, srcUuid, srcOut, dstUuid, dstIn);
    renderEditor();
    return r;
  };

  // ── Runtime ──
  window.__studioBPRuntimeStart = runtimeStart;
  window.__studioBPRuntimeStop  = runtimeStop;
  window.__studioBPFireKey = (key) => (_runtime ? _runtime.fireKey(key) : { ok: false });

  // ── Persistence ──
  window.__studioBPSerialize = () => ({ ok: true, json: toJSON(_graph) });
  window.__studioBPDeserialize = (json) => {
    const wasRunning = !!(_runtime && _runtime.started);
    if (_runtime) _runtime.stop();
    _graph = fromJSON(json);
    if (_runtime) _runtime.setGraph(_graph);
    if (wasRunning) _runtime.start();
    renderEditor();
    return { ok: true, count: _graph.nodes.size };
  };

  // ── Editor toggles ──
  window.__studioBPEditorOpen   = editorOpen;
  window.__studioBPEditorClose  = editorClose;
  window.__studioBPEditorToggle = editorToggle;

  // ── Listing / introspection ──
  window.__studioBPListNodes = listNodes;
  window.__studioBPGraph = () => _graph;
  window.__studioBPRuntime = () => _runtime;

  // ── ESC closes editor when open. ──
  _escListener = (e) => {
    if (e.key === 'Escape' && _editorOpen) {
      const ae = (typeof document !== 'undefined') ? document.activeElement : null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      editorClose();
      e.preventDefault();
    }
  };
  window.addEventListener('keydown', _escListener);

  // ── Register every op with the V3 command palette via common/registry.js.
  registerOps({
    __studioBPNodeAdd:        [window.__studioBPNodeAdd,        'Add a Blueprints node (kind, params)'],
    __studioBPNodeRemove:     [window.__studioBPNodeRemove,     'Remove a Blueprints node by uuid'],
    __studioBPConnectExec:    [window.__studioBPConnectExec,    'Connect an exec wire between two nodes'],
    __studioBPConnectData:    [window.__studioBPConnectData,    'Connect a data wire between two nodes'],
    __studioBPDisconnect:     [window.__studioBPDisconnect,     'Disconnect a wire by endpoints'],
    __studioBPRuntimeStart:   [window.__studioBPRuntimeStart,   'Start the Blueprints runtime (arms OnStart/OnTick/OnKeyDown)'],
    __studioBPRuntimeStop:    [window.__studioBPRuntimeStop,    'Stop the Blueprints runtime'],
    __studioBPFireKey:        [window.__studioBPFireKey,        'Manually fire OnKeyDown for a given key (testing)'],
    __studioBPSerialize:      [window.__studioBPSerialize,      'Serialise the Blueprints graph to JSON'],
    __studioBPDeserialize:    [window.__studioBPDeserialize,    'Replace the Blueprints graph from JSON'],
    __studioBPEditorOpen:     [window.__studioBPEditorOpen,     'Open the Blueprints editor'],
    __studioBPEditorClose:    [window.__studioBPEditorClose,    'Close the Blueprints editor'],
    __studioBPEditorToggle:   [window.__studioBPEditorToggle,   'Toggle the Blueprints editor'],
    __studioBPListNodes:      [window.__studioBPListNodes,      'List nodes + wires currently in the graph'],
  }, 'bp');

  return { ok: true, ops: 14 };
}

// Mostly for tests / hot-reload.
export function uninstallBlueprints() {
  if (!_installed) return { ok: true };
  _installed = false;
  if (_runtime) { try { _runtime.stop(); } catch (_) {} }
  unregisterOps([
    '__studioBPNodeAdd', '__studioBPNodeRemove',
    '__studioBPConnectExec', '__studioBPConnectData', '__studioBPDisconnect',
    '__studioBPRuntimeStart', '__studioBPRuntimeStop', '__studioBPFireKey',
    '__studioBPSerialize', '__studioBPDeserialize',
    '__studioBPEditorOpen', '__studioBPEditorClose', '__studioBPEditorToggle',
    '__studioBPListNodes', '__studioBPGraph', '__studioBPRuntime',
  ]);
  if (_escListener) {
    try { window.removeEventListener('keydown', _escListener); } catch (_) {}
    _escListener = null;
  }
  if (_panel) { unmountPanel('bp-editor'); _panel = null; }
  _editorOpen = false;
  _graph = null;
  _runtime = null;
  return { ok: true };
}
