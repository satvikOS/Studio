// ArchDisc Studio V3 — Substance Designer visual node graph editor
// (slice 791).
//
// `installSDGraphEdit()` registers the window.__studioSDGraph* surface
// that drives a visual graph editor. Users drag-drop nodes (slice-775
// generators + filters), connect them, and evaluate the DAG to a final
// 256×256 texture that ships back as a PNG dataURL.
//
// Op surface:
//   __studioSDGraphCreate({name})                        → {ok, key, name}
//   __studioSDGraphAddNode({key, type, params})          → {ok, nodeId}
//   __studioSDGraphConnect({key, fromNode, toNode, port})→ {ok}
//   __studioSDGraphEvaluate({key, outputNodeId})         → {ok, dataUrl}
//   __studioSDGraphList()                                → {ok, graphs:[]}
//   __studioSDGraphDelete({key})                         → {ok}
//
// Also exported for the visual editor / debug:
//   __studioSDGraphRemoveNode({key, nodeId})             → {ok}
//   __studioSDGraphDisconnect({key, toNode, port})       → {ok}
//   __studioSDGraphListTypes()                           → {ok, types:[]}
//   __studioSDGraphSerialize({key})                      → {ok, json}
//
// Pure JS. Imports three.js only for the CanvasTexture pinned on
// `window.__studioSDGraphLastTexture` (mirrors the slice-775 pattern).

import * as THREE from 'three';
import { registerOps, unregisterOps } from '../common/registry.js';
import { SDGraph } from './graph.js';
import {
  getNodeTypes, listNodeTypes, NODE_TYPE_KINDS,
} from './nodeTypes.js';

const _graphs = new Map(); // key → SDGraph
let _seq = 1;
function _uid() { return `sdgraph-${_seq++}`; }

function _getOrFail(key) {
  const g = _graphs.get(String(key || ''));
  if (!g) return null;
  return g;
}

function _bufferToDataUrl(buf, size) {
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < buf.length; i++) {
    const v = buf[i];
    const c = Math.max(0, Math.min(255, Math.round(v * 255)));
    const j = i * 4;
    img.data[j] = c; img.data[j + 1] = c; img.data[j + 2] = c; img.data[j + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Pin a Three.js CanvasTexture for callers that want the live texture
  // object — the dataURL stays the shippable payload.
  try {
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    if (typeof window !== 'undefined') window.__studioSDGraphLastTexture = tex;
  } catch (_) { /* document but no THREE — still ship the dataURL. */ }
  return cv.toDataURL('image/png');
}

// ─── Op implementations ──────────────────────────────────────────────────

function createOp(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const name = String(a.name || 'graph');
  const g = new SDGraph(name);
  g.setNodeTypes(getNodeTypes());
  const key = _uid();
  _graphs.set(key, g);
  return { ok: true, key, name: g.name };
}

function addNodeOp(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const g = _getOrFail(a.key);
  if (!g) return { ok: false, error: `unknown graph: ${a.key || '∅'}` };
  const type = String(a.type || '');
  const types = getNodeTypes();
  if (!types[type]) return { ok: false, error: `unknown node type: ${type || '∅'}` };
  const params = (a.params && typeof a.params === 'object') ? a.params : {};
  const nodeId = g.addNode(type, params);
  return { ok: true, nodeId, type, kind: types[type].kind };
}

function connectOp(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const g = _getOrFail(a.key);
  if (!g) return { ok: false, error: `unknown graph: ${a.key || '∅'}` };
  const fromNode = String(a.fromNode || '');
  const toNode = String(a.toNode || '');
  const port = String(a.port || 'in');
  const ok = g.connect(fromNode, toNode, port);
  if (!ok) return { ok: false, error: 'connect failed (missing node or self-edge)' };
  return { ok: true, fromNode, toNode, port };
}

function disconnectOp(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const g = _getOrFail(a.key);
  if (!g) return { ok: false, error: `unknown graph: ${a.key || '∅'}` };
  const toNode = String(a.toNode || '');
  const port = String(a.port || 'in');
  const removed = g.disconnect(toNode, port);
  return { ok: true, removed };
}

function removeNodeOp(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const g = _getOrFail(a.key);
  if (!g) return { ok: false, error: `unknown graph: ${a.key || '∅'}` };
  const ok = g.removeNode(String(a.nodeId || ''));
  return { ok: true, removed: !!ok };
}

function evaluateOp(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const g = _getOrFail(a.key);
  if (!g) return { ok: false, error: `unknown graph: ${a.key || '∅'}` };
  const out = String(a.outputNodeId || '');
  const r = g.evaluate(out || undefined);
  if (!r.ok) return { ok: false, error: r.error || 'evaluate failed' };
  const dataUrl = _bufferToDataUrl(r.buffer, r.size);
  if (!dataUrl) return { ok: false, error: 'no document for export' };
  return {
    ok: true,
    dataUrl,
    size: r.size,
    evaluatedCount: r.evaluatedCount,
  };
}

function listOp() {
  const graphs = [];
  for (const [key, g] of _graphs.entries()) {
    graphs.push({
      key,
      name: g.name,
      nodeCount: g.nodes.length,
      edgeCount: g.edges.length,
      size: g.size,
    });
  }
  return { ok: true, count: graphs.length, graphs };
}

function deleteOp(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const had = _graphs.delete(String(a.key || ''));
  return { ok: true, deleted: had };
}

function listTypesOp() {
  return {
    ok: true,
    types: listNodeTypes(),
    kinds: {
      generator: NODE_TYPE_KINDS.generator.slice(),
      filter: NODE_TYPE_KINDS.filter.slice(),
      output: NODE_TYPE_KINDS.output.slice(),
    },
  };
}

function serializeOp(args) {
  const a = (args && typeof args === 'object') ? args : {};
  const g = _getOrFail(a.key);
  if (!g) return { ok: false, error: `unknown graph: ${a.key || '∅'}` };
  return { ok: true, json: g.toJSON() };
}

// ─── Install ─────────────────────────────────────────────────────────────
let _installed = false;

export function installSDGraphEdit() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioSDGraphEditInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioSDGraphEditInstalled = true;

  registerOps({
    __studioSDGraphCreate: [createOp,
      'Substance Designer visual graph editor — create a new graph from {name}; returns {key}.'],
    __studioSDGraphAddNode: [addNodeOp,
      'Substance Designer visual graph editor — add a node {type, params} to graph {key}; returns {nodeId}.'],
    __studioSDGraphConnect: [connectOp,
      'Substance Designer visual graph editor — connect {fromNode}->{toNode}.{port} in graph {key}.'],
    __studioSDGraphDisconnect: [disconnectOp,
      'Substance Designer visual graph editor — drop the edge feeding {toNode}.{port} in graph {key}.'],
    __studioSDGraphRemoveNode: [removeNodeOp,
      'Substance Designer visual graph editor — remove node {nodeId} + any touching edges.'],
    __studioSDGraphEvaluate: [evaluateOp,
      'Substance Designer visual graph editor — evaluate DAG from {outputNodeId}; returns {dataUrl}.'],
    __studioSDGraphList: [listOp,
      'Substance Designer visual graph editor — list every stored graph + its node/edge counts.'],
    __studioSDGraphDelete: [deleteOp,
      'Substance Designer visual graph editor — release the graph at {key}.'],
    __studioSDGraphListTypes: [listTypesOp,
      'Substance Designer visual graph editor — list all registered node types (12 gens + 8 filters + output).'],
    __studioSDGraphSerialize: [serializeOp,
      'Substance Designer visual graph editor — return a JSON-safe snapshot of graph {key}.'],
  }, 'matlib', 'Substance Designer visual node graph editor (slice 791).');

  return {
    ok: true,
    alreadyInstalled: false,
    nodeTypes: Object.keys(getNodeTypes()).length,
  };
}

export function uninstallSDGraphEdit() {
  if (!_installed) return { ok: true };
  unregisterOps([
    '__studioSDGraphCreate', '__studioSDGraphAddNode',
    '__studioSDGraphConnect', '__studioSDGraphDisconnect',
    '__studioSDGraphRemoveNode', '__studioSDGraphEvaluate',
    '__studioSDGraphList', '__studioSDGraphDelete',
    '__studioSDGraphListTypes', '__studioSDGraphSerialize',
  ]);
  _installed = false;
  if (typeof window !== 'undefined') window.__studioSDGraphEditInstalled = false;
  _graphs.clear();
  return { ok: true };
}

export const __internal = { _graphs };

export default installSDGraphEdit;
