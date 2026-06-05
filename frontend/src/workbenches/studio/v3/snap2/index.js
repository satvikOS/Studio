// ArchDisc Studio V3 — snap2 installer + window.__studioSnap2* surface.
//
// `installSnap2()` is idempotent. It:
//   • exposes the window.__studioSnap2* op surface listed in the slice
//     brief
//   • mounts a SnapPanel side widget into a body-attached host so we
//     never touch StudioShellV3.jsx
//   • auto-registers every op with the V3 command palette under the
//     'snap' category
//
// Builds on top of slice 655's `window.__studioSnapState` (defined in
// api.js) without overwriting it — kindMask in snapDuringDrag.js syncs
// from `__studioSnapState.mode` so toggling the basic snap chip flips
// the snap-during-drag kind in lockstep.

import React from 'react';
import { createRoot } from 'react-dom/client';

import {
  install as installLiveDrag,
  setLiveDrag, setSnapRadius, setKindMask, setGridSize,
  getState as getDragState, stepSnap, teardown as teardownLiveDrag,
} from './snapDuringDrag.js';

import {
  install as installOrient,
  setOrientation, setCustomOrientation, getOrientation,
} from './orientations.js';

import {
  install as installPivot,
  setPivot, getPivot, computePivot, teardown as teardownPivot,
} from './pivot.js';

import SnapPanel from './SnapPanel.jsx';

let _installed = false;

// ─── Panel lifecycle ─────────────────────────────────────────────────
let _host = null;
let _root = null;
let _open = false;

function mountHost() {
  if (typeof document === 'undefined') return null;
  if (_host) return _host;
  _host = document.createElement('div');
  _host.setAttribute('data-studio-v3-snap2-host', '');
  document.body.appendChild(_host);
  _root = createRoot(_host);
  return _host;
}

function renderPanel() {
  if (!_root) return;
  if (!_open) { _root.render(null); return; }
  _root.render(
    React.createElement(SnapPanel, {
      getState: () => getDragState(),
      setLiveDrag: (on) => { setLiveDrag(on); renderPanel(); },
      setRadius:   (r)  => { setSnapRadius(r); renderPanel(); },
      setKind:     (k, on) => {
        const mask = {}; mask[k] = on; setKindMask(mask); renderPanel();
      },
      getOrient: () => getOrientation(),
      setOrient: (k) => { setOrientation(k); renderPanel(); },
      setCustomAxes: (axes) => { setCustomOrientation(axes); renderPanel(); },
      getPivot: () => getPivot(),
      setPivot: (k) => { setPivot(k); renderPanel(); },
      onCloseRequest: () => panelClose(),
    })
  );
}

function panelOpen()   { mountHost(); _open = true;  renderPanel(); return { ok: true, open: true }; }
function panelClose()  { _open = false; renderPanel(); return { ok: true, open: false }; }
function panelToggle() { return _open ? panelClose() : panelOpen(); }

// ─── Op registration helper ──────────────────────────────────────────
function reg(name, fn, description) {
  if (typeof window === 'undefined') return;
  window[name] = fn;
  const tryReg = () => {
    if (typeof window.__studioCommandRegister !== 'function') return false;
    try {
      window.__studioCommandRegister(name, fn, { category: 'snap', description });
      return true;
    } catch (_) { return false; }
  };
  if (!tryReg()) {
    // Defer; api.js's registerV3Api may not have run yet on cold start.
    let tries = 0;
    const id = setInterval(() => {
      tries++;
      if (tryReg() || tries > 40) clearInterval(id);
    }, 25);
  }
}

const OP_NAMES = [
  '__studioSnap2EnableLiveDrag',
  '__studioSnap2SetRadius',
  '__studioSnap2SetKindMask',
  '__studioSnap2SetGridSize',
  '__studioSnap2GetState',
  '__studioSnap2Step',
  '__studioSnap2SetOrientation',
  '__studioSnap2SetCustomOrientation',
  '__studioSnap2GetOrientation',
  '__studioSnap2SetPivot',
  '__studioSnap2GetPivot',
  '__studioSnap2ComputePivot',
  '__studioSnap2PanelOpen',
  '__studioSnap2PanelClose',
  '__studioSnap2PanelToggle',
];

// ─── Install ─────────────────────────────────────────────────────────
export function installSnap2() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, alreadyInstalled: true };
  _installed = true;

  installLiveDrag();
  installOrient();
  installPivot();

  reg('__studioSnap2EnableLiveDrag', (on) => {
    const r = setLiveDrag(on);
    if (_open) renderPanel();
    return r;
  }, 'Enable live snap-during-drag (vertex/edge/face/grid).');

  reg('__studioSnap2SetRadius', (r) => {
    const out = setSnapRadius(r);
    if (_open) renderPanel();
    return out;
  }, 'Set the snap search radius in scene units (default 0.05).');

  reg('__studioSnap2SetKindMask', (mask) => {
    const out = setKindMask(mask);
    if (_open) renderPanel();
    return out;
  }, 'Set which candidate kinds the snap considers ({ vertex, edge, face, grid }).');

  reg('__studioSnap2SetGridSize', (g) => {
    const out = setGridSize(g);
    if (_open) renderPanel();
    return out;
  }, 'Override the grid spacing used by the grid snap kind.');

  reg('__studioSnap2GetState', () => getDragState(),
    'Read snap-during-drag state (on, radius, mask, dragging, lastSnap).');

  reg('__studioSnap2Step', () => stepSnap(),
    'Manually trigger one snap step (test hook; pointermove drives this in normal use).');

  reg('__studioSnap2SetOrientation', (kind) => {
    const r = setOrientation(kind);
    if (_open) renderPanel();
    return r;
  }, "Set transform orientation: 'global'|'local'|'normal'|'gimbal'|'view'|'custom'.");

  reg('__studioSnap2SetCustomOrientation', (axes) => {
    const r = setCustomOrientation(axes);
    if (_open) renderPanel();
    return r;
  }, 'Set the [x,y,z] axis (or 9-element basis) for the Custom orientation.');

  reg('__studioSnap2GetOrientation', () => getOrientation(),
    'Read the current transform orientation kind + custom axes.');

  reg('__studioSnap2SetPivot', (kind) => {
    const r = setPivot(kind);
    if (_open) renderPanel();
    return r;
  }, "Set pivot point: 'bbox'|'median'|'individual'|'active'|'cursor'.");

  reg('__studioSnap2GetPivot', () => getPivot(),
    'Read the current pivot point kind.');

  reg('__studioSnap2ComputePivot', (kind) => {
    const sel = (Array.isArray(window.__studioSelectedMeshesSet)
      && window.__studioSelectedMeshesSet.length)
      ? window.__studioSelectedMeshesSet
      : (window.__studioSelectedMesh && window.__studioSelectedMesh()
        ? [window.__studioSelectedMesh()] : []);
    const k = kind || getPivot().kind;
    const v = computePivot(sel, k);
    return { ok: true, kind: k, point: [v.x, v.y, v.z], count: sel.length };
  }, 'Compute the world-space pivot point for the current selection + kind.');

  reg('__studioSnap2PanelOpen',   panelOpen,   'Open the snap2 N-panel side widget.');
  reg('__studioSnap2PanelClose',  panelClose,  'Close the snap2 N-panel side widget.');
  reg('__studioSnap2PanelToggle', panelToggle, 'Toggle the snap2 N-panel side widget.');

  // Esc closes the panel.
  if (typeof window !== 'undefined') {
    const onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if (e.key === 'Escape' && _open) { panelClose(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
  }

  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallSnap2() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  teardownLiveDrag();
  teardownPivot();
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
  return { ok: true };
}

export default installSnap2;
