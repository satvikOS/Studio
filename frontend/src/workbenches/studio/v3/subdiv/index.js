// ArchDisc Studio V3 — subdivision-surface installer.
//
// `installSubdiv()` is idempotent. It:
//   • exposes the window.__studioSubdiv* op surface listed in the
//     slice brief (wrap / unwrap / setLevel / setEdgeCrease /
//     clearCreases / listCreases / setCageVertex / showCage / apply /
//     panel open / close / toggle)
//   • mounts a SubdivPanel side widget into a body-attached host so
//     we never touch StudioShellV3.jsx
//   • auto-registers every op with the V3 command palette under the
//     'edit' category
//
// Hot-path code is split into loopSubdiv.js (math), surface.js
// (lifecycle), crease.js (per-edge weights), cageEdit.js (vertex
// writeback). This file is just the orchestration layer.

import React from 'react';
import { createRoot } from 'react-dom/client';

import {
  wrap as surfaceWrap,
  unwrap as surfaceUnwrap,
  setLevel as surfaceSetLevel,
  apply as surfaceApply,
  showCage as surfaceShowCage,
  isWrapped,
  getCage,
  CAGE_KEY,
  LEVEL_KEY,
  WRAPPED_KEY,
  DEFAULT_LEVELS,
} from './surface.js';
import {
  setEdgeCrease,
  clearCreases,
  listCreases,
  meshByUuid,
} from './crease.js';
import { setCageVertex, nudgeCageVertex, getCageVertex } from './cageEdit.js';
import SubdivPanel from './SubdivPanel.jsx';

let _installed = false;

// ─── Panel lifecycle ─────────────────────────────────────────────────
let _host = null;
let _root = null;
let _open = false;
const _cageShown = new Map(); // meshUuid → bool

function mountHost() {
  if (typeof document === 'undefined') return null;
  if (_host) return _host;
  _host = document.createElement('div');
  _host.setAttribute('data-studio-v3-subdiv-host', '');
  document.body.appendChild(_host);
  _root = createRoot(_host);
  return _host;
}

function getSelectedMesh() {
  if (typeof window === 'undefined') return null;
  const fn = window.__studioSelectedMesh;
  if (typeof fn !== 'function') return null;
  try { return fn() || null; } catch (_) { return null; }
}

function selUuid() {
  const m = getSelectedMesh();
  return m ? m.uuid : null;
}

function readStatus() {
  const m = getSelectedMesh();
  if (!m) return { wrapped: false };
  const wrapped = isWrapped(m);
  const cage = getCage(m);
  const smoothVerts = m.geometry && m.geometry.attributes && m.geometry.attributes.position
    ? m.geometry.attributes.position.count : 0;
  return {
    wrapped,
    cageShown: !!_cageShown.get(m.uuid),
    cageVerts: cage ? cage.vertCount : 0,
    smoothVerts,
    levels: cage && Number.isFinite(cage.levels) ? cage.levels : DEFAULT_LEVELS,
  };
}

function renderPanel() {
  if (!_root) return;
  if (!_open) { _root.render(null); return; }
  _root.render(
    React.createElement(SubdivPanel, {
      getSelectedMesh,
      getStatus: () => readStatus(),
      onWrap: (lv) => {
        const u = selUuid();
        if (!u) return;
        wrapOp(u, lv);
        renderPanel();
      },
      onUnwrap: () => {
        const u = selUuid();
        if (!u) return;
        unwrapOp(u);
        renderPanel();
      },
      onSetLevel: (lv) => {
        const u = selUuid();
        if (!u) return;
        setLevelOp(u, lv);
        renderPanel();
      },
      onApply: () => {
        const u = selUuid();
        if (!u) return;
        applyOp(u);
        renderPanel();
      },
      onShowCage: (on) => {
        const u = selUuid();
        if (!u) return;
        showCageOp(u, on);
        renderPanel();
      },
      listCreases: () => {
        const u = selUuid();
        if (!u) return { count: 0, creases: [] };
        return listCreases(u);
      },
      setEdgeCrease: (i, j, w) => {
        const u = selUuid();
        if (!u) return;
        setEdgeCreaseOp(u, i, j, w);
        renderPanel();
      },
      removeCrease: (i, j) => {
        const u = selUuid();
        if (!u) return;
        setEdgeCreaseOp(u, i, j, 0);
        renderPanel();
      },
      clearCreases: () => {
        const u = selUuid();
        if (!u) return;
        clearCreasesOp(u);
        renderPanel();
      },
      onCloseRequest: () => panelClose(),
    }),
  );
}

function panelOpen()   { mountHost(); _open = true;  renderPanel(); return { ok: true, open: true }; }
function panelClose()  { _open = false; renderPanel(); return { ok: true, open: false }; }
function panelToggle() { return _open ? panelClose() : panelOpen(); }

// ─── Op implementations (so the panel can drive them too) ────────────
function wrapOp(uuid, levels) {
  if (typeof window !== 'undefined' && window.__studioPushUndo) {
    try { window.__studioPushUndo('subdiv-wrap'); } catch (_) {}
  }
  return surfaceWrap(uuid, levels == null ? DEFAULT_LEVELS : levels);
}
function unwrapOp(uuid) {
  if (typeof window !== 'undefined' && window.__studioPushUndo) {
    try { window.__studioPushUndo('subdiv-unwrap'); } catch (_) {}
  }
  const r = surfaceUnwrap(uuid);
  if (r && r.ok) _cageShown.delete(uuid);
  return r;
}
function setLevelOp(uuid, levels) {
  return surfaceSetLevel(uuid, levels);
}
function applyOp(uuid) {
  if (typeof window !== 'undefined' && window.__studioPushUndo) {
    try { window.__studioPushUndo('subdiv-apply'); } catch (_) {}
  }
  const r = surfaceApply(uuid);
  if (r && r.ok) _cageShown.delete(uuid);
  return r;
}
function showCageOp(uuid, on) {
  const r = surfaceShowCage(uuid, on);
  if (r && r.ok) _cageShown.set(uuid, !!on);
  return r;
}
function setEdgeCreaseOp(uuid, i, j, w) {
  const r = setEdgeCrease(uuid, Number(i), Number(j), Number(w));
  // If wrapped, rebuild so the crease change becomes visible.
  const m = meshByUuid(uuid);
  if (m && isWrapped(m)) {
    const lv = Number(m.userData[LEVEL_KEY]);
    surfaceSetLevel(m, Number.isFinite(lv) ? lv : DEFAULT_LEVELS);
  }
  return r;
}
function clearCreasesOp(uuid) {
  const r = clearCreases(uuid);
  const m = meshByUuid(uuid);
  if (m && isWrapped(m)) {
    const lv = Number(m.userData[LEVEL_KEY]);
    surfaceSetLevel(m, Number.isFinite(lv) ? lv : DEFAULT_LEVELS);
  }
  return r;
}
function setCageVertexOp(uuid, idx, xyz) {
  if (typeof window !== 'undefined' && window.__studioPushUndo) {
    try { window.__studioPushUndo('subdiv-cage-edit'); } catch (_) {}
  }
  return setCageVertex(uuid, Number(idx), xyz);
}

// ─── Command registration ────────────────────────────────────────────
function reg(name, fn, description) {
  if (typeof window === 'undefined') return;
  window[name] = fn;
  const tryReg = () => {
    if (typeof window.__studioCommandRegister !== 'function') return false;
    try {
      window.__studioCommandRegister(name, fn, { category: 'edit', description });
      return true;
    } catch (_) {
      return false;
    }
  };
  if (!tryReg()) {
    let tries = 0;
    const id = setInterval(() => {
      tries++;
      if (tryReg() || tries > 40) clearInterval(id);
    }, 25);
  }
}

const OP_NAMES = [
  '__studioSubdivWrap',
  '__studioSubdivUnwrap',
  '__studioSubdivSetLevel',
  '__studioSubdivSetEdgeCrease',
  '__studioSubdivClearCreases',
  '__studioSubdivListCreases',
  '__studioSubdivSetCageVertex',
  '__studioSubdivNudgeCageVertex',
  '__studioSubdivGetCageVertex',
  '__studioSubdivShowCage',
  '__studioSubdivApply',
  '__studioSubdivStatus',
  '__studioSubdivPanelOpen',
  '__studioSubdivPanelClose',
  '__studioSubdivPanelToggle',
];

export function installSubdiv() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, alreadyInstalled: true };
  _installed = true;

  reg('__studioSubdivWrap', (uuid, levels) => {
    const u = uuid || selUuid();
    if (!u) return { ok: false, error: 'no mesh' };
    return wrapOp(u, levels);
  }, 'Wrap mesh as a Loop-subdivision surface (cage stored, smooth result rendered).');

  reg('__studioSubdivUnwrap', (uuid) => {
    const u = uuid || selUuid();
    if (!u) return { ok: false, error: 'no mesh' };
    return unwrapOp(u);
  }, 'Restore the editable cage as the live geometry (destroys subdiv).');

  reg('__studioSubdivSetLevel', (uuid, levels) => {
    const u = uuid || selUuid();
    if (!u) return { ok: false, error: 'no mesh' };
    return setLevelOp(u, levels);
  }, 'Re-evaluate the subdiv surface at the given Loop level (0..6).');

  reg('__studioSubdivSetEdgeCrease', (uuid, i, j, weight) => {
    const u = uuid || selUuid();
    if (!u) return { ok: false, error: 'no mesh' };
    return setEdgeCreaseOp(u, i, j, weight);
  }, 'Set the crease weight [0..1] on a cage edge (welded indices i,j).');

  reg('__studioSubdivClearCreases', (uuid) => {
    const u = uuid || selUuid();
    if (!u) return { ok: false, error: 'no mesh' };
    return clearCreasesOp(u);
  }, 'Clear every edge crease on the mesh.');

  reg('__studioSubdivListCreases', (uuid) => {
    const u = uuid || selUuid();
    if (!u) return { ok: true, count: 0, creases: [] };
    return listCreases(u);
  }, 'List the edge creases on the mesh (i, j, weight, key).');

  reg('__studioSubdivSetCageVertex', (uuid, idx, xyz) => {
    const u = uuid || selUuid();
    if (!u) return { ok: false, error: 'no mesh' };
    return setCageVertexOp(u, idx, xyz);
  }, 'Edit a single cage vertex and re-evaluate the smooth surface.');

  reg('__studioSubdivNudgeCageVertex', (uuid, idx, dxyz) => {
    const u = uuid || selUuid();
    if (!u) return { ok: false, error: 'no mesh' };
    return nudgeCageVertex(u, Number(idx), dxyz);
  }, 'Nudge a cage vertex by a delta vector and re-evaluate.');

  reg('__studioSubdivGetCageVertex', (uuid, idx) => {
    const u = uuid || selUuid();
    if (!u) return { ok: false, error: 'no mesh' };
    const xyz = getCageVertex(u, Number(idx));
    return xyz ? { ok: true, xyz } : { ok: false, error: 'no cage vert' };
  }, 'Read a single cage vertex.');

  reg('__studioSubdivShowCage', (uuid, on) => {
    const u = uuid || selUuid();
    if (!u) return { ok: false, error: 'no mesh' };
    return showCageOp(u, !!on);
  }, 'Toggle the orange wireframe cage helper for the subdiv surface.');

  reg('__studioSubdivApply', (uuid) => {
    const u = uuid || selUuid();
    if (!u) return { ok: false, error: 'no mesh' };
    return applyOp(u);
  }, 'Bake the current smooth result into the cage (drops subdiv state).');

  reg('__studioSubdivStatus', (uuid) => {
    const m = uuid ? meshByUuid(uuid) : getSelectedMesh();
    if (!m) return { ok: false, error: 'no mesh' };
    const wrapped = isWrapped(m);
    const cage = getCage(m);
    const smoothVerts = m.geometry && m.geometry.attributes.position
      ? m.geometry.attributes.position.count : 0;
    return {
      ok: true,
      uuid: m.uuid,
      wrapped,
      cageShown: !!_cageShown.get(m.uuid),
      cageVerts: cage ? cage.vertCount : 0,
      smoothVerts,
      levels: cage && Number.isFinite(cage.levels) ? cage.levels : null,
    };
  }, 'Read the subdiv status (wrapped, cageShown, cage/smooth vert counts, level).');

  reg('__studioSubdivPanelOpen',   panelOpen,   'Open the Subdivision Surface side panel.');
  reg('__studioSubdivPanelClose',  panelClose,  'Close the Subdivision Surface side panel.');
  reg('__studioSubdivPanelToggle', panelToggle, 'Toggle the Subdivision Surface side panel.');

  // Esc closes the panel.
  if (typeof window !== 'undefined') {
    const onKey = (e) => {
      const ae = document && document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if (e.key === 'Escape' && _open) { panelClose(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
  }

  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallSubdiv() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  for (const k of OP_NAMES) {
    try { delete window[k]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(k); } catch (_) {}
    }
  }
  if (_root) { try { _root.unmount(); } catch (_) {} _root = null; }
  if (_host && _host.parentNode) _host.parentNode.removeChild(_host);
  _host = null;
  _open = false;
  _installed = false;
  _cageShown.clear();
  return { ok: true };
}

export default installSubdiv;
