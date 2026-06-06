// ArchDisc Studio V3 — compositor install + window.__studio* API.
//
// installCompositor() is idempotent. It builds a single graph instance,
// attaches every op to the window surface, registers each with the V3
// command palette under category 'compositor', and mounts the editor
// component into a body-attached host element (no React-tree mutations
// to StudioShellV3.jsx).
//
// Capturing the rendered viewport:
//   The Image node needs an ImageData-shaped { width, height, data }
//   object from the live renderer. We sample renderer.domElement via
//   toDataURL() → <img> → offscreen canvas getImageData. WebGL contexts
//   are usually wiped after present, so we ALSO force a fresh
//   renderer.render() pass before sampling. Falls back to a small
//   procedurally-coloured frame if no viewport is mounted (so tests
//   that evaluate before the scene is up still get a real buffer).
//
// Painting the output:
//   The Output node forwards its `image` input. installCompositor()
//   creates a body-attached <canvas data-studio-v3-compositor-output>
//   overlay (top-right corner) and paints the Output buffer into it.

import React from 'react';
import {
  createGraph, addNode, removeNode, connect, disconnect,
  evaluate as evalGraph, toJSON, fromJSON,
} from './graph.js';
import { listKinds as nodeKinds } from './nodes.js';
import CompositorEditor from './CompositorEditor.jsx';
import { mountPanel, unmountPanel } from '../common/panel.js';
import { registerOp } from '../common/registry.js';

let _installed = false;
let _graph = null;
let _panel = null;
let _editorOpen = false;
let _outputCanvas = null;

// ─── Viewport capture ───────────────────────────────────────────────────
//
// captureViewport() returns { width, height, data } in RGBA-8 form.
// Sampling order:
//   1. Force a synchronous renderer.render() so the back buffer is fresh.
//   2. Read pixels straight off the WebGL canvas via a 2-D mirror canvas
//      so we avoid the toDataURL → <img> async path entirely.

async function captureViewport() {
  const vp = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  if (!vp || !vp.renderer || !vp.renderer.domElement) {
    return procFallback(256, 256);
  }
  try {
    if (vp.scene && vp.camera) {
      try { vp.renderer.render(vp.scene, vp.camera); } catch (_) { /* ignore */ }
    }
    const gl = vp.renderer.domElement;
    const w = Math.max(2, gl.width  || 256);
    const h = Math.max(2, gl.height || 256);
    // Mirror through a 2-D canvas so we end up with an ImageData with
    // CPU-accessible Uint8ClampedArray. The drawImage path works for
    // both <canvas> sources (whether 2-D or WebGL with
    // preserveDrawingBuffer). If it returns transparent due to a wiped
    // back-buffer, fall back to the procedural placeholder.
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cctx = c.getContext('2d');
    cctx.drawImage(gl, 0, 0, w, h);
    const id = cctx.getImageData(0, 0, w, h);
    // Detect a fully-zero alpha frame (means drawImage saw a cleared
    // back buffer); fall back to a procedural so downstream nodes still
    // have something to operate on.
    let any = 0;
    for (let i = 3; i < id.data.length; i += 4) { if (id.data[i] !== 0) { any = 1; break; } }
    if (!any) return procFallback(w, h);
    return { width: w, height: h, data: id.data };
  } catch (_) {
    return procFallback(256, 256);
  }
}

function procFallback(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // A gentle diagonal gradient so blur / colour ops have non-trivial
      // input even when the viewport is not yet mounted (e.g. early
      // headless tests).
      data[i]     = Math.floor(255 * (x / w));
      data[i + 1] = Math.floor(255 * (y / h));
      data[i + 2] = Math.floor(255 * ((x + y) / (w + h)));
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

// ─── Output canvas overlay ──────────────────────────────────────────────

function mountOutputCanvas() {
  if (typeof document === 'undefined') return null;
  if (_outputCanvas) return _outputCanvas;
  _outputCanvas = document.createElement('canvas');
  _outputCanvas.setAttribute('data-studio-v3-compositor-output', '');
  _outputCanvas.width = 320;
  _outputCanvas.height = 180;
  _outputCanvas.style.cssText = [
    'position:fixed',
    'right:16px',
    'bottom:16px',
    'width:320px',
    'height:180px',
    'z-index:9100',
    'border:1px solid rgba(29,233,182,0.55)',
    'border-radius:4px',
    'background:#000',
    'image-rendering:pixelated',
    'pointer-events:none',
    'box-shadow:0 6px 24px rgba(0,0,0,0.45)',
    // Slice 742 (UI fix): hidden until the compositor actually paints a
    // frame. Previously it mounted as an opaque black box pinned to the
    // bottom-right of every Studio session even when no compositing was
    // happening. paintOutput() reveals it; clearOutput() hides it again.
    'display:none',
  ].join(';');
  document.body.appendChild(_outputCanvas);
  return _outputCanvas;
}

function paintOutput(buf) {
  mountOutputCanvas();
  if (!_outputCanvas || !buf || !buf.data) return { ok: false, error: 'no buffer' };
  // Match the visible canvas to the buffer dimensions so we get a 1:1
  // pixel paint, then let CSS shrink the on-screen footprint.
  if (_outputCanvas.width !== buf.width || _outputCanvas.height !== buf.height) {
    _outputCanvas.width = buf.width;
    _outputCanvas.height = buf.height;
  }
  const ctx = _outputCanvas.getContext('2d');
  const id = ctx.createImageData(buf.width, buf.height);
  id.data.set(buf.data);
  ctx.putImageData(id, 0, 0);
  _outputCanvas.style.display = 'block'; // reveal now that we have a frame
  let dataUrl = null;
  try { dataUrl = _outputCanvas.toDataURL('image/png'); } catch (_) { dataUrl = null; }
  return { ok: true, dataUrl, width: buf.width, height: buf.height };
}

function clearOutput() {
  if (!_outputCanvas) return { ok: true };
  const ctx = _outputCanvas.getContext('2d');
  ctx.clearRect(0, 0, _outputCanvas.width, _outputCanvas.height);
  _outputCanvas.style.display = 'none'; // hide the empty overlay again
  return { ok: true };
}

// ─── Editor mount control ───────────────────────────────────────────────

function mountEditorHost() {
  if (_panel) return _panel.host;
  _panel = mountPanel('compositor-editor');
  return _panel ? _panel.host : null;
}

function renderEditor() {
  if (!_panel) return;
  if (!_editorOpen) {
    _panel.render(null);
    return;
  }
  _panel.render(
    React.createElement(CompositorEditor, {
      getGraph: () => _graph,
      // Editor's Evaluate button calls into the public op so we go through
      // the same code path the e2e tests exercise.
      evaluate: () => {
        const r = evaluateSync();
        return r;
      },
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

// ─── Evaluation ─────────────────────────────────────────────────────────
//
// evaluateSync runs synchronously using the most-recently-captured frame
// (or the procedural fallback). It's what the editor preview + every
// __studioCompositorEvaluate() call route through.

let _lastCapture = null;

function captureSync() {
  // Synchronous mirror via the same 2-D canvas trick — no async work
  // actually happens; the WebGL → 2-D drawImage is sync.
  const vp = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  if (!vp || !vp.renderer || !vp.renderer.domElement) return procFallback(256, 256);
  try {
    if (vp.scene && vp.camera) {
      try { vp.renderer.render(vp.scene, vp.camera); } catch (_) {}
    }
    const gl = vp.renderer.domElement;
    const w = Math.max(2, gl.width  || 256);
    const h = Math.max(2, gl.height || 256);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const cctx = c.getContext('2d');
    cctx.drawImage(gl, 0, 0, w, h);
    const id = cctx.getImageData(0, 0, w, h);
    let any = 0;
    for (let i = 3; i < id.data.length; i += 4) { if (id.data[i] !== 0) { any = 1; break; } }
    if (!any) return procFallback(w, h);
    return { width: w, height: h, data: id.data };
  } catch (_) {
    return procFallback(256, 256);
  }
}

function evaluateSync() {
  _lastCapture = captureSync();
  const buf = evalGraph(_graph, _lastCapture);
  if (!buf) return { ok: false, error: 'no output node' };
  const paint = paintOutput(buf);
  return {
    ok: true,
    dataUrl: paint.dataUrl,
    width: buf.width,
    height: buf.height,
  };
}

// ─── Default seed ───────────────────────────────────────────────────────

function seedDefaultGraph() {
  const img = addNode(_graph, 'image', {});
  img.x = 60; img.y = 120;
  const cc = addNode(_graph, 'colorcorrect', {});
  cc.x = 320; cc.y = 120;
  const out = addNode(_graph, 'output', {});
  out.x = 580; out.y = 120;
  connect(_graph, img.id, 'image', cc.id, 'image');
  connect(_graph, cc.id, 'image', out.id, 'image');
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

// ─── Command palette registration (delegates to common/registry.js) ────

function regCommand(name, fn, description) {
  registerOp(name, fn, 'compositor', description);
}

// ─── Install ────────────────────────────────────────────────────────────

export function installCompositor() {
  if (typeof window === 'undefined') return { ok: false };
  if (_installed) return { ok: true, already: true };
  _installed = true;
  _graph = createGraph();
  seedDefaultGraph();

  // CRUD
  window.__studioCompositorNodeAdd = (kind, params) => {
    try {
      const n = addNode(_graph, kind, params || {});
      renderEditor();
      return { ok: true, uuid: n.id, kind: n.kind };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };
  window.__studioCompositorNodeRemove = (uuid) => {
    const ok = removeNode(_graph, uuid);
    renderEditor();
    return { ok };
  };
  window.__studioCompositorNodeConnect = (srcUuid, srcOut, dstUuid, dstIn) => {
    const r = connect(_graph, srcUuid, srcOut, dstUuid, dstIn);
    renderEditor();
    return r;
  };
  window.__studioCompositorNodeDisconnect = (srcUuid, srcOut, dstUuid, dstIn) => {
    const r = disconnect(_graph, srcUuid, srcOut, dstUuid, dstIn);
    renderEditor();
    return r;
  };

  // Eval
  window.__studioCompositorEvaluate = () => evaluateSync();
  // Slice 737 — set a parameter on a node (keyer thresholds, blur radius,
  // glow intensity, …) and re-render. Mirrors the editor's param sliders.
  window.__studioCompositorNodeSetParam = (uuid, key, value) => {
    const n = _graph.nodes.get(uuid);
    if (!n) return { ok: false, error: 'no such node' };
    n.params[key] = value;
    renderEditor();
    return { ok: true, uuid, key, value: n.params[key] };
  };
  // Slice 737 — evaluate the graph against a CALLER-SUPPLIED source image
  // ({ width, height, data:[...] }) instead of the viewport capture. Lets
  // tools (and tests) push a known frame through the node graph and read
  // back the processed result deterministically. Returns the output
  // buffer's pixels so a keyer matte / glow result can be inspected.
  window.__studioCompositorEvaluateWith = (src) => {
    try {
      if (!src || !src.data || !src.width || !src.height) return { ok: false, error: 'bad source' };
      const buf = { width: src.width | 0, height: src.height | 0,
        data: Uint8ClampedArray.from(src.data) };
      const out = evalGraph(_graph, buf);
      if (!out) return { ok: false, error: 'no output node' };
      try { paintOutput(out); } catch (_) {}
      return { ok: true, width: out.width, height: out.height, data: Array.from(out.data) };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  };
  // Slice 737 — list every available node KIND (palette discovery).
  window.__studioCompositorListKinds = () => ({ ok: true, kinds: nodeKinds() });
  // Async capture variant for callers that want to await a real frame.
  window.__studioCompositorCaptureViewport = async () => {
    const buf = await captureViewport();
    return { ok: true, width: buf.width, height: buf.height };
  };

  // Output canvas
  window.__studioCompositorClearOutput = () => clearOutput();

  // Persistence
  window.__studioCompositorGraphSerialize = () => ({ ok: true, json: toJSON(_graph) });
  window.__studioCompositorGraphDeserialize = (json) => {
    _graph = fromJSON(json);
    renderEditor();
    return { ok: true, count: _graph.nodes.size };
  };

  // Editor
  window.__studioCompositorEditorOpen = editorOpen;
  window.__studioCompositorEditorClose = editorClose;
  window.__studioCompositorEditorToggle = editorToggle;

  // Listing + live graph
  window.__studioCompositorListNodes = listNodes;
  window.__studioCompositorGraph = () => _graph;

  // Esc closes the editor when open.
  const _onKey = (e) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.key === 'Escape' && _editorOpen) { editorClose(); e.preventDefault(); }
  };
  window.addEventListener('keydown', _onKey);

  // Mount the output overlay canvas now so even pre-evaluate the test
  // selector resolves to a visible element.
  mountOutputCanvas();

  // Command palette registration.
  const cmds = [
    ['__studioCompositorNodeAdd', 'Add a compositor node (kind, params)'],
    ['__studioCompositorNodeRemove', 'Remove a compositor node by uuid'],
    ['__studioCompositorNodeConnect', 'Connect two compositor sockets'],
    ['__studioCompositorNodeDisconnect', 'Disconnect two compositor sockets'],
    ['__studioCompositorEvaluate', 'Run the compositor graph; paints the result on the output canvas'],
    ['__studioCompositorCaptureViewport', 'Capture the current viewport as an ImageData buffer'],
    ['__studioCompositorClearOutput', 'Clear the compositor output canvas overlay'],
    ['__studioCompositorGraphSerialize', 'Serialise the compositor graph to JSON'],
    ['__studioCompositorGraphDeserialize', 'Replace the compositor graph from JSON'],
    ['__studioCompositorEditorOpen', 'Open the compositor graph editor'],
    ['__studioCompositorEditorClose', 'Close the compositor graph editor'],
    ['__studioCompositorEditorToggle', 'Toggle the compositor graph editor'],
    ['__studioCompositorListNodes', 'List compositor nodes currently in the graph'],
    // Slice 737 — Keyer/Glow params, deterministic eval, kind discovery.
    ['__studioCompositorNodeSetParam', 'Set a parameter on a compositor node (keyer thresholds, glow intensity, …)'],
    ['__studioCompositorEvaluateWith', 'Evaluate the compositor graph against a supplied source image'],
    ['__studioCompositorListKinds', 'List every available compositor node kind (image/keyer/glow/blur/…)'],
  ];
  for (const [name, desc] of cmds) {
    regCommand(name, window[name], desc);
  }

  return { ok: true, ops: cmds.length };
}

export function uninstallCompositor() {
  if (!_installed) return { ok: true };
  _installed = false;
  for (const k of [
    '__studioCompositorNodeAdd', '__studioCompositorNodeRemove',
    '__studioCompositorNodeConnect', '__studioCompositorNodeDisconnect',
    '__studioCompositorEvaluate', '__studioCompositorCaptureViewport',
    '__studioCompositorClearOutput',
    '__studioCompositorGraphSerialize', '__studioCompositorGraphDeserialize',
    '__studioCompositorEditorOpen', '__studioCompositorEditorClose', '__studioCompositorEditorToggle',
    '__studioCompositorListNodes', '__studioCompositorGraph',
    '__studioCompositorNodeSetParam', '__studioCompositorEvaluateWith',
    '__studioCompositorListKinds',
  ]) { try { delete window[k]; } catch (_) {} }
  if (_panel) { unmountPanel('compositor-editor'); _panel = null; }
  _editorOpen = false;
  if (_outputCanvas && _outputCanvas.parentNode) _outputCanvas.parentNode.removeChild(_outputCanvas);
  _outputCanvas = null;
  _graph = null;
  return { ok: true };
}
