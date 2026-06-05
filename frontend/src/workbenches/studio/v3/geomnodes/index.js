// ArchDisc Studio V3 — geometry-nodes install + window.__studio* API.
//
// installGeomNodes() is idempotent. It builds a single graph instance,
// attaches every op described in the slice brief, registers them with
// the V3 command palette under category 'geomnodes', and mounts the
// editor component into a body-attached host so we don't touch
// StudioShellV3.jsx.
//
// Mesh creation strategy: __studioGeomBuildMesh evaluates the graph and
// adds a brand-new THREE.Mesh into window.__archdiscScene. The mesh is
// tagged with userData.archdiscStudioPrimitive so existing scene-stat /
// save-scene paths discover it automatically.

import React from 'react';
import { createRoot } from 'react-dom/client';
import * as THREE from 'three';
import {
  createGraph, addNode, removeNode, connect, disconnect,
  evaluate, toJSON, fromJSON,
} from './graph.js';
import GeomNodesEditor from './GeomNodesEditor.jsx';

let _installed = false;
let _graph = null;
let _editorHost = null;
let _editorRoot = null;
let _editorOpen = false;

// ─── Editor mount control ────────────────────────────────────────────────
function mountEditorHost() {
  if (typeof document === 'undefined') return null;
  if (_editorHost) return _editorHost;
  _editorHost = document.createElement('div');
  _editorHost.setAttribute('data-studio-v3-geomnodes-editor-host', '');
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
    React.createElement(GeomNodesEditor, {
      getGraph: () => _graph,
      evalOnly: () => evaluateGraph(),
      buildMesh: () => buildMesh(),
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

// ─── Graph evaluation helpers ────────────────────────────────────────────
function evaluateGraph() {
  const geo = evaluate(_graph);
  if (!geo || !geo.attributes || !geo.attributes.position) {
    return { ok: false, error: 'evaluation produced no geometry', vertices: 0, triangles: 0 };
  }
  const v = geo.attributes.position.count;
  const t = geo.index ? geo.index.count / 3 : v / 3;
  return { ok: true, vertices: v, triangles: Math.floor(t) };
}

function buildMesh() {
  const scene = (typeof window !== 'undefined') ? window.__archdiscScene : null;
  if (!scene) return { ok: false, error: 'no scene' };
  const geo = evaluate(_graph);
  if (!geo || !geo.attributes || !geo.attributes.position || geo.attributes.position.count === 0) {
    return { ok: false, error: 'evaluation produced no geometry' };
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8bbcd6, roughness: 0.55, metalness: 0.1 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'geomnodes-output';
  mesh.userData = mesh.userData || {};
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'geomnodes';
  mesh.userData.archdiscStudioGeomNodes = true;
  scene.add(mesh);
  if (typeof window !== 'undefined' && window.__studioSelectMesh) {
    try { window.__studioSelectMesh(mesh); } catch (_) { /* ignore */ }
  }
  return { ok: true, uuid: mesh.uuid, vertices: geo.attributes.position.count };
}

// Seed a default sphere → output graph so first-open is meaningful.
function seedDefaultGraph() {
  const prim = addNode(_graph, 'primitive', { shape: 'sphere', radius: 0.6, segments: 24 });
  prim.x = 60; prim.y = 120;
  const xf = addNode(_graph, 'transform', { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
  xf.x = 300; xf.y = 120;
  const out = addNode(_graph, 'output', {});
  out.x = 540; out.y = 120;
  connect(_graph, prim.id, 'geometry', xf.id, 'geometry');
  connect(_graph, xf.id, 'geometry', out.id, 'geometry');
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
export function installGeomNodes() {
  if (typeof window === 'undefined') return { ok: false };
  if (_installed) return { ok: true, already: true };
  _installed = true;
  _graph = createGraph();
  seedDefaultGraph();

  // CRUD.
  window.__studioGeomNodeAdd = (kind, params) => {
    try {
      const n = addNode(_graph, kind, params || {});
      renderEditor();
      return { ok: true, uuid: n.id, kind: n.kind };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };
  window.__studioGeomNodeRemove = (uuid) => {
    const ok = removeNode(_graph, uuid);
    renderEditor();
    return { ok };
  };
  window.__studioGeomNodeConnect = (srcUuid, srcOut, dstUuid, dstIn) => {
    const r = connect(_graph, srcUuid, srcOut, dstUuid, dstIn);
    renderEditor();
    return r;
  };
  window.__studioGeomNodeDisconnect = (srcUuid, srcOut, dstUuid, dstIn) => {
    const r = disconnect(_graph, srcUuid, srcOut, dstUuid, dstIn);
    renderEditor();
    return r;
  };

  // Eval / build.
  window.__studioGeomEvaluate = () => evaluateGraph();
  window.__studioGeomBuildMesh = () => buildMesh();

  // Persistence.
  window.__studioGeomGraphSerialize = () => ({ ok: true, json: toJSON(_graph) });
  window.__studioGeomGraphDeserialize = (json) => {
    _graph = fromJSON(json);
    renderEditor();
    return { ok: true, count: _graph.nodes.size };
  };

  // Editor toggles.
  window.__studioGeomEditorOpen = editorOpen;
  window.__studioGeomEditorClose = editorClose;
  window.__studioGeomEditorToggle = editorToggle;

  // Listing.
  window.__studioGeomListNodes = listNodes;
  // Expose the live graph for advanced introspection / tests.
  window.__studioGeomGraph = () => _graph;

  // Esc closes the editor.
  const _onKey = (e) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.key === 'Escape' && _editorOpen) { editorClose(); e.preventDefault(); }
  };
  window.addEventListener('keydown', _onKey);

  // Register every op with the V3 command palette under category 'geomnodes'.
  const reg = window.__studioCommandRegister;
  if (typeof reg === 'function') {
    const cat = 'geomnodes';
    const cmds = [
      ['__studioGeomNodeAdd', 'Add a geometry node (kind, params)'],
      ['__studioGeomNodeRemove', 'Remove a geometry node by uuid'],
      ['__studioGeomNodeConnect', 'Connect two geometry sockets'],
      ['__studioGeomNodeDisconnect', 'Disconnect two geometry sockets'],
      ['__studioGeomEvaluate', 'Evaluate the geometry graph (stats)'],
      ['__studioGeomBuildMesh', 'Evaluate and add a Mesh to the scene'],
      ['__studioGeomGraphSerialize', 'Serialise the geometry graph to JSON'],
      ['__studioGeomGraphDeserialize', 'Replace the graph from JSON'],
      ['__studioGeomEditorOpen', 'Open the geometry-nodes editor'],
      ['__studioGeomEditorClose', 'Close the geometry-nodes editor'],
      ['__studioGeomEditorToggle', 'Toggle the geometry-nodes editor'],
      ['__studioGeomListNodes', 'List geometry nodes currently in the graph'],
    ];
    for (const [name, desc] of cmds) {
      reg(name, window[name], { category: cat, description: desc });
    }
  }

  return { ok: true, ops: 12 };
}

// For tests / hot-reload.
export function uninstallGeomNodes() {
  if (!_installed) return { ok: true };
  _installed = false;
  for (const k of [
    '__studioGeomNodeAdd', '__studioGeomNodeRemove',
    '__studioGeomNodeConnect', '__studioGeomNodeDisconnect',
    '__studioGeomEvaluate', '__studioGeomBuildMesh',
    '__studioGeomGraphSerialize', '__studioGeomGraphDeserialize',
    '__studioGeomEditorOpen', '__studioGeomEditorClose', '__studioGeomEditorToggle',
    '__studioGeomListNodes', '__studioGeomGraph',
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
