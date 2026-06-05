// ArchDisc Studio V3 — VEX-style ASL install entry.
//
// installVex() is idempotent. It:
//   • exposes the __studioVex* op surface described in the slice brief
//   • mounts the React Editor.jsx into a body-attached host so we don't
//     touch StudioShellV3.jsx
//   • auto-registers every op with the V3 command palette under the
//     'vex' category, retrying once on the next tick if the registry
//     isn't installed yet (race-free under both cold + warm starts).
//
// The whole module is `eval`-free / `new Function`-free — the parser +
// interpreter are pure JS, and we never construct any code at runtime.

import React from 'react';
import Editor from './Editor.jsx';
import {
  parseScript,
  runOnSelection,
  runOnMesh,
  EXAMPLES,
  EXAMPLE_NAMES,
  MAX_VERTS,
} from './runner.js';
import { mountPanel, unmountPanel } from '../common/panel.js';
import { registerOp, unregisterOps } from '../common/registry.js';

let _installed = false;
let _panel = null;
let _editorOpen = false;
let _editorScript = EXAMPLES['twist-y'];

// ── Editor lifecycle ────────────────────────────────────────────────

function mountEditorHost() {
  if (_panel) return _panel.host;
  _panel = mountPanel('vex-editor');
  return _panel ? _panel.host : null;
}

function renderEditor() {
  if (!_panel) return;
  if (!_editorOpen) { _panel.render(null); return; }
  _panel.render(
    React.createElement(Editor, {
      initialScript: _editorScript,
      onCloseRequest: () => editorClose(),
    }),
  );
}

function editorOpen() {
  mountEditorHost();
  if (_editorOpen) return { ok: true, open: true };
  _editorOpen = true;
  renderEditor();
  return { ok: true, open: true };
}

function editorClose() {
  if (!_editorOpen) return { ok: true, open: false };
  _editorOpen = false;
  renderEditor();
  return { ok: true, open: false };
}

function editorToggle() {
  return _editorOpen ? editorClose() : editorOpen();
}

function editorIsOpen() { return _editorOpen; }

// ── Op registration helper (delegates to common/registry.js) ──────

function reg(name, fn, description) {
  registerOp(name, fn, 'vex', description);
}

// ── Install entry ───────────────────────────────────────────────────

export function installVex() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  reg('__studioVexParse', (script) => {
    const r = parseScript(script);
    if (r.ok) return { ok: true };
    return { ok: false, error: r.error, line: r.line, col: r.col };
  }, 'Parse-only check for an ASL script (no execution).');

  reg('__studioVexRun', (script) => {
    const r = runOnSelection(script);
    if (!r.ok) return r;
    return { ok: true, touched: r.touched, uuid: r.uuid };
  }, 'Run an ASL script against the active selection.');

  reg('__studioVexRunOnMesh', (uuid, script) => {
    const r = runOnMesh(uuid, script);
    if (!r.ok) return r;
    return { ok: true, touched: r.touched, uuid: r.uuid };
  }, 'Run an ASL script against a specific mesh by uuid.');

  reg('__studioVexEditorOpen',   editorOpen,   'Open the ASL script editor.');
  reg('__studioVexEditorClose',  editorClose,  'Close the ASL script editor.');
  reg('__studioVexEditorToggle', editorToggle, 'Toggle the ASL script editor.');
  reg('__studioVexEditorIsOpen', editorIsOpen, 'Return true if the editor is open.');

  reg('__studioVexSetScript', (script) => {
    _editorScript = String(script || '');
    if (_editorOpen) renderEditor();
    return { ok: true, length: _editorScript.length };
  }, 'Replace the editor textarea contents from code.');

  reg('__studioVexGetScript', () => ({ ok: true, script: _editorScript }),
    'Return the editor textarea contents.');

  reg('__studioVexExamples', () => ({
    ok: true,
    names: EXAMPLE_NAMES.slice(),
    scripts: { ...EXAMPLES },
  }), 'Return the built-in example library (names + scripts).');

  reg('__studioVexLoadExample', (name) => {
    if (!EXAMPLES[name]) return { ok: false, error: `unknown example "${name}"` };
    _editorScript = EXAMPLES[name];
    if (_editorOpen) renderEditor();
    return { ok: true, name, length: _editorScript.length };
  }, 'Load an example by name into the editor.');

  reg('__studioVexLimits', () => ({ ok: true, maxVertices: MAX_VERTS }),
    'Return runtime limits (vertex cap, etc).');

  return { ok: true, alreadyInstalled: false };
}

export function uninstallVex() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  unregisterOps([
    '__studioVexParse', '__studioVexRun', '__studioVexRunOnMesh',
    '__studioVexEditorOpen', '__studioVexEditorClose', '__studioVexEditorToggle',
    '__studioVexEditorIsOpen',
    '__studioVexSetScript', '__studioVexGetScript',
    '__studioVexExamples', '__studioVexLoadExample', '__studioVexLimits',
  ]);
  if (_panel) { unmountPanel('vex-editor'); _panel = null; }
  _editorOpen = false;
  _installed = false;
  return { ok: true };
}

export default installVex;
