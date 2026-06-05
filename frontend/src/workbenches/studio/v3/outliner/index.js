// ArchDisc Studio V3 — Outliner installer.
//
// installOutliner() is idempotent. Wires every __studioOutliner* op,
// mounts the React panel into a body-attached host (so we never touch
// StudioShellV3.jsx), and registers each op with the V3 command registry
// under category 'outliner'.
//
// Tree state lives here, not in the React panel:
//   • _expanded     — Set<uuid> of expanded rows. Defaults: root scene
//                     uuid (auto-detected first time we observe a scene)
//                     is auto-expanded so the top is open out of the box.
//   • _refreshTick  — incremented by __studioOutlinerRefresh to force a
//                     re-render that bypasses the panel's setInterval.

import React from 'react';
import OutlinerPanel from './OutlinerPanel.jsx';
import { tree, countAll } from './tree.js';
import { mountPanel, unmountPanel } from '../common/panel.js';
import { registerOp, unregisterOps } from '../common/registry.js';

let _installed = false;
let _panel = null;
let _open = false;
let _expanded = new Set();
let _expandedRev = 0;
let _refreshTick = 0;
let _autoExpandedRoot = false;

// ─── Host / mount helpers ────────────────────────────────────────────────
function ensureHost() {
  if (_panel) return _panel.host;
  _panel = mountPanel('outliner');
  return _panel ? _panel.host : null;
}

function autoExpandRoot() {
  if (_autoExpandedRoot) return;
  const scene = (typeof window !== 'undefined') ? window.__archdiscScene : null;
  if (!scene) return;
  _expanded.add(scene.uuid);
  _autoExpandedRoot = true;
}

function setExpandedRevWrapper(updater) {
  _expandedRev = typeof updater === 'function' ? updater(_expandedRev) : Number(updater) || 0;
  render();
}

function render() {
  if (!_panel) return;
  if (!_open) { _panel.render(null); return; }
  autoExpandRoot();
  _panel.render(
    React.createElement(OutlinerPanel, {
      expandedRef: { current: _expanded },
      setExpandedRev: setExpandedRevWrapper,
      refreshSignal: _refreshTick,
      onSelect: (uuid) => selectOp(uuid),
      onRename: (uuid, name) => renameOp(uuid, name),
      onToggleVisible: (uuid) => toggleVisibleOp(uuid),
      onToggleFrozen: (uuid) => toggleFrozenOp(uuid),
      onCollapseAll: () => collapseAllOp(),
      onExpandAll: () => expandAllOp(),
      onCloseRequest: () => closeOp(),
    }),
  );
}

// ─── Open / close ────────────────────────────────────────────────────────
function openOp() {
  ensureHost();
  _open = true;
  render();
  return { ok: true, open: true };
}

function closeOp() {
  _open = false;
  render();
  return { ok: true, open: false };
}

function toggleOp() {
  return _open ? closeOp() : openOp();
}

// ─── Tree readout ────────────────────────────────────────────────────────
function treeOp() {
  const scene = (typeof window !== 'undefined') ? window.__archdiscScene : null;
  // Tree readout ignores collapse state — callers want the full hierarchy.
  const rows = tree(scene);
  return {
    ok: true,
    count: rows.length,
    rows,
    counts: countAll(scene),
    open: _open,
  };
}

// ─── Expansion ───────────────────────────────────────────────────────────
function expandOp(uuid, on) {
  if (typeof uuid !== 'string' || !uuid) return { ok: false, error: 'bad uuid' };
  const want = (on === undefined) ? true : !!on;
  if (want) _expanded.add(uuid); else _expanded.delete(uuid);
  setExpandedRevWrapper((r) => r + 1);
  return { ok: true, uuid, expanded: want };
}

function expandAllOp() {
  const scene = (typeof window !== 'undefined') ? window.__archdiscScene : null;
  if (!scene) return { ok: false, error: 'no scene' };
  scene.traverse((o) => { _expanded.add(o.uuid); });
  setExpandedRevWrapper((r) => r + 1);
  return { ok: true, count: _expanded.size };
}

function collapseAllOp() {
  _expanded.clear();
  _autoExpandedRoot = false; // re-expand root next render
  setExpandedRevWrapper((r) => r + 1);
  return { ok: true };
}

// ─── Per-row mutations ───────────────────────────────────────────────────
function findObject(uuid) {
  const scene = (typeof window !== 'undefined') ? window.__archdiscScene : null;
  if (!scene || !uuid) return null;
  return scene.getObjectByProperty('uuid', uuid) || null;
}

function toggleVisibleOp(uuid) {
  const o = findObject(uuid);
  if (!o) return { ok: false, error: 'not found' };
  o.visible = !o.visible;
  refreshOp();
  return { ok: true, uuid, visible: !!o.visible };
}

function toggleFrozenOp(uuid) {
  const o = findObject(uuid);
  if (!o) return { ok: false, error: 'not found' };
  if (!o.userData) o.userData = {};
  o.userData.archdiscStudioFrozen = !o.userData.archdiscStudioFrozen;
  refreshOp();
  return { ok: true, uuid, frozen: !!o.userData.archdiscStudioFrozen };
}

function renameOp(uuid, name) {
  const o = findObject(uuid);
  if (!o) return { ok: false, error: 'not found' };
  const next = String(name == null ? '' : name).trim();
  if (!next) return { ok: false, error: 'empty name' };
  o.name = next;
  refreshOp();
  return { ok: true, uuid, name: o.name };
}

function selectOp(uuid) {
  const o = findObject(uuid);
  if (!o) return { ok: false, error: 'not found' };
  // Prefer the V3 select op; fall back to the viewport's transformControls
  // directly so the outliner still works when the orchestrator hasn't
  // finished wiring everything.
  if (typeof window.__studioSelectMesh === 'function') {
    try {
      const r = window.__studioSelectMesh(o);
      if (r && r.ok) { refreshOp(); return { ok: true, uuid, name: o.name }; }
    } catch (_) { /* fall through */ }
  }
  const vp = (typeof window !== 'undefined') ? window.__archdiscViewport : null;
  if (vp && vp.transformControls && o.isObject3D) {
    try { vp.transformControls.attach(o); refreshOp(); return { ok: true, uuid, name: o.name }; }
    catch (_) { /* swallow */ }
  }
  return { ok: false, error: 'no selector' };
}

function refreshOp() {
  _refreshTick += 1;
  if (_open) render();
  return { ok: true, tick: _refreshTick };
}

// ─── Install ─────────────────────────────────────────────────────────────
const OPS = {
  __studioOutlinerOpen:           ['Open the Outliner panel',                  openOp],
  __studioOutlinerClose:          ['Close the Outliner panel',                 closeOp],
  __studioOutlinerToggle:         ['Toggle the Outliner panel',                toggleOp],
  __studioOutlinerTree:           ['Return the flattened scene tree rows',     treeOp],
  __studioOutlinerExpand:         ['Set expansion state for a node (uuid, on)', expandOp],
  __studioOutlinerToggleVisible:  ['Toggle object.visible by uuid',            toggleVisibleOp],
  __studioOutlinerToggleFrozen:   ['Toggle userData.archdiscStudioFrozen by uuid', toggleFrozenOp],
  __studioOutlinerRename:         ['Rename a scene object by uuid',            renameOp],
  __studioOutlinerSelect:         ['Select a scene object by uuid',            selectOp],
  __studioOutlinerCollapseAll:    ['Collapse every Outliner node',             collapseAllOp],
  __studioOutlinerExpandAll:      ['Expand every Outliner node',               expandAllOp],
  __studioOutlinerRefresh:        ['Force the Outliner panel to re-read the scene', refreshOp],
};

export function installOutliner() {
  if (typeof window === 'undefined') return { ok: false };
  if (_installed) return { ok: true, already: true, ops: Object.keys(OPS).length };
  _installed = true;

  for (const [name, [, fn]] of Object.entries(OPS)) {
    window[name] = fn;
  }

  // Hotkey: Escape closes the panel when focus isn't in an input.
  const onKey = (e) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.key === 'Escape' && _open) { closeOp(); e.preventDefault(); }
  };
  window.addEventListener('keydown', onKey);

  // Register via common/registry.js (cold-start retry built-in).
  for (const [name, [desc]] of Object.entries(OPS)) {
    registerOp(name, window[name], 'outliner', desc);
  }

  return { ok: true, ops: Object.keys(OPS).length };
}

export function uninstallOutliner() {
  if (!_installed) return { ok: true };
  _installed = false;
  unregisterOps(Object.keys(OPS));
  if (_panel) { unmountPanel('outliner'); _panel = null; }
  _open = false; _expanded = new Set(); _autoExpandedRoot = false;
  return { ok: true };
}
