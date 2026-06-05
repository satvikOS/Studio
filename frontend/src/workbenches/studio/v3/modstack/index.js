// ArchDisc Studio V3 — non-destructive modifier stack installer.
//
// `installModStack()` wires:
//   - the window.__studioModStack* op surface,
//   - command-palette registration under category 'modstack',
//   - a body-attached React panel (so we don't touch StudioShellV3.jsx),
//   - an internal `window.__studioModStackRebuild()` that callers can
//     use to re-evaluate from base without changing the stack.
//
// Idempotent — guarded by `window.__studioModStackInstalled`.

import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  SUPPORTED_KINDS,
  addMod, listMods, setEnabled, setViewport, setParams,
  reorder, removeMod, clearAll, applyAll, resetToBase,
  rebuildStack,
} from './stack.js';
import ModStackPanel from './ModStackPanel.jsx';

let _installed = false;
let _host = null;
let _root = null;
let _open = false;

function getSelectedMesh() {
  if (typeof window === 'undefined') return null;
  if (typeof window.__studioSelectedMesh === 'function') {
    try { return window.__studioSelectedMesh() || null; } catch (_) {}
  }
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}

function mountHost() {
  if (typeof document === 'undefined') return null;
  if (_host) return _host;
  _host = document.createElement('div');
  _host.setAttribute('data-studio-v3-modstack-host', '');
  document.body.appendChild(_host);
  _root = createRoot(_host);
  return _host;
}

function renderPanel() {
  if (!_root) return;
  if (!_open) { _root.render(null); return; }
  _root.render(
    React.createElement(ModStackPanel, {
      getSelectedMesh,
      listMods: () => {
        const m = getSelectedMesh();
        if (!m) return { count: 0, mods: [] };
        return listMods(m);
      },
      onAdd: (kind) => {
        const m = getSelectedMesh(); if (!m) return;
        addMod(m, kind, undefined);
        renderPanel();
      },
      onSetEnabled: (uuid, on) => {
        const m = getSelectedMesh(); if (!m) return;
        setEnabled(m, uuid, on);
        renderPanel();
      },
      onSetViewport: (uuid, on) => {
        const m = getSelectedMesh(); if (!m) return;
        setViewport(m, uuid, on);
        renderPanel();
      },
      onSetParams: (uuid, p) => {
        const m = getSelectedMesh(); if (!m) return;
        setParams(m, uuid, p);
        renderPanel();
      },
      onReorder: (uuid, newIndex) => {
        const m = getSelectedMesh(); if (!m) return;
        reorder(m, uuid, newIndex);
        renderPanel();
      },
      onRemove: (uuid) => {
        const m = getSelectedMesh(); if (!m) return;
        removeMod(m, uuid);
        renderPanel();
      },
      onClear: () => {
        const m = getSelectedMesh(); if (!m) return;
        clearAll(m);
        renderPanel();
      },
      onApplyAll: () => {
        const m = getSelectedMesh(); if (!m) return;
        applyAll(m);
        renderPanel();
      },
      onResetToBase: () => {
        const m = getSelectedMesh(); if (!m) return;
        resetToBase(m);
        renderPanel();
      },
      onCloseRequest: panelClose,
    }),
  );
}

function panelOpen()   { mountHost(); _open = true;  renderPanel(); return { ok: true, open: true }; }
function panelClose()  { _open = false; renderPanel(); return { ok: true, open: false }; }
function panelToggle() { return _open ? panelClose() : panelOpen(); }

function reg(name, fn, description) {
  window[name] = fn;
  const tryReg = () => {
    if (typeof window.__studioCommandRegister !== 'function') return false;
    try {
      window.__studioCommandRegister(name, fn, { category: 'modstack', description });
      return true;
    } catch (_) { return false; }
  };
  // Try now + on the next macrotask to cover the autoload-vs-registerV3Api race.
  if (!tryReg()) setTimeout(tryReg, 0);
}

export function installModStack() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (window.__studioModStackInstalled) return { ok: true, alreadyInstalled: true };
  window.__studioModStackInstalled = true;

  // Add — every modifier kind.
  reg('__studioModStackAdd', (kind, params) => {
    const m = getSelectedMesh();
    if (!m) return { ok: false, error: 'no mesh' };
    if (!SUPPORTED_KINDS.includes(kind)) {
      return { ok: false, error: `unsupported kind: ${kind}` };
    }
    const r = addMod(m, kind, params);
    renderPanel();
    return r;
  }, `Add a modifier to the active mesh (kinds: ${SUPPORTED_KINDS.join(' | ')}).`);

  reg('__studioModStackList', () => {
    const m = getSelectedMesh();
    if (!m) return { count: 0, mods: [] };
    return listMods(m);
  }, 'List the active mesh\'s modifier stack.');

  reg('__studioModStackSetEnabled', (uuid, on) => {
    const m = getSelectedMesh();
    if (!m) return { ok: false, error: 'no mesh' };
    const r = setEnabled(m, uuid, on);
    renderPanel();
    return r;
  }, 'Enable / disable a modifier (rebuilds geometry from base).');

  reg('__studioModStackSetViewport', (uuid, on) => {
    const m = getSelectedMesh();
    if (!m) return { ok: false, error: 'no mesh' };
    const r = setViewport(m, uuid, on);
    renderPanel();
    return r;
  }, 'Toggle a modifier\'s viewport preview without disabling it.');

  reg('__studioModStackReorder', (uuid, newIndex) => {
    const m = getSelectedMesh();
    if (!m) return { ok: false, error: 'no mesh' };
    const r = reorder(m, uuid, newIndex);
    renderPanel();
    return r;
  }, 'Move a modifier to a new index (top-to-bottom evaluation).');

  reg('__studioModStackSetParams', (uuid, params) => {
    const m = getSelectedMesh();
    if (!m) return { ok: false, error: 'no mesh' };
    const r = setParams(m, uuid, params);
    renderPanel();
    return r;
  }, 'Replace a modifier\'s params (rebuilds from base).');

  reg('__studioModStackRemove', (uuid) => {
    const m = getSelectedMesh();
    if (!m) return { ok: false, error: 'no mesh' };
    const r = removeMod(m, uuid);
    renderPanel();
    return r;
  }, 'Remove a modifier (rebuilds from base).');

  reg('__studioModStackClear', () => {
    const m = getSelectedMesh();
    if (!m) return { ok: false, error: 'no mesh' };
    const r = clearAll(m);
    renderPanel();
    return r;
  }, 'Remove every modifier (rebuilds — restores base geometry).');

  reg('__studioModStackApplyAll', () => {
    const m = getSelectedMesh();
    if (!m) return { ok: false, error: 'no mesh' };
    const r = applyAll(m);
    renderPanel();
    return r;
  }, 'Bake the current evaluated geometry as the new base + clear stack.');

  reg('__studioModStackResetToBase', () => {
    const m = getSelectedMesh();
    if (!m) return { ok: false, error: 'no mesh' };
    const r = resetToBase(m);
    renderPanel();
    return r;
  }, 'Restore base geometry, keep the stack (re-enable to see mods).');

  reg('__studioModStackRebuild', () => {
    const m = getSelectedMesh();
    if (!m) return { ok: false, error: 'no mesh' };
    return rebuildStack(m);
  }, 'Re-evaluate the stack from base (internal).');

  reg('__studioModStackSupportedKinds', () => SUPPORTED_KINDS.slice(),
    'List the modifier kinds the stack supports.');

  // Panel toggles.
  reg('__studioModStackPanelOpen',   panelOpen,   'Open the modifier stack side panel.');
  reg('__studioModStackPanelClose',  panelClose,  'Close the modifier stack side panel.');
  reg('__studioModStackPanelToggle', panelToggle, 'Toggle the modifier stack side panel.');

  // Esc closes the panel when no input is focused.
  const onKey = (e) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.key === 'Escape' && _open) { panelClose(); e.preventDefault(); }
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);

  _installed = true;
  return { ok: true, alreadyInstalled: false };
}

export function uninstallModStack() {
  if (typeof window === 'undefined') return { ok: false };
  for (const k of [
    '__studioModStackAdd', '__studioModStackList',
    '__studioModStackSetEnabled', '__studioModStackSetViewport',
    '__studioModStackReorder', '__studioModStackSetParams',
    '__studioModStackRemove', '__studioModStackClear',
    '__studioModStackApplyAll', '__studioModStackResetToBase',
    '__studioModStackRebuild', '__studioModStackSupportedKinds',
    '__studioModStackPanelOpen', '__studioModStackPanelClose', '__studioModStackPanelToggle',
  ]) {
    try { delete window[k]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(k); } catch (_) {}
    }
  }
  if (_root) { try { _root.unmount(); } catch (_) {} _root = null; }
  if (_host && _host.parentNode) _host.parentNode.removeChild(_host);
  _host = null; _open = false;
  window.__studioModStackInstalled = false;
  _installed = false;
  return { ok: true };
}
