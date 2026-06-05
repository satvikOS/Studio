// ArchDisc Studio V3 — foliage system installer.
//
// `installFoliage()` binds every scatter / LOD / wind / paint op to
// `window.__studioFoliage*`, registers each under the 'foliage' category
// via __studioCommandRegister, and mounts the FoliagePanel into a
// body-attached host (so StudioShellV3.jsx stays untouched).
//
// Idempotent (guarded by `window.__studioFoliageInstalled`). The
// autoloader (foliage/autoload.js) calls this on import; the orchestrator
// can wire `import('./foliage/autoload.js').catch(() => {});` into
// api.js in a follow-up slice. Until then the e2e dynamic-imports the
// autoload module against the dev server.

import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  scatterOnSurface, listFoliage, deleteFoliage, findFoliageByUuid,
} from './scatter.js';
import {
  setupLOD, removeLOD, setLODDistance, listLOD,
} from './lod.js';
import {
  setWind, clearWind, listWind,
} from './wind.js';
import {
  enterPaintMode, exitPaintMode, paintModeStatus, addAt, removeAt,
} from './paint.js';
import FoliagePanel from './FoliagePanel.jsx';

let _installed = false;
let _panelHost = null;
let _panelRoot = null;
let _panelOpen = false;

// ─── Panel lifecycle ─────────────────────────────────────────────────
function mountPanelHost() {
  if (typeof document === 'undefined') return null;
  if (_panelHost) return _panelHost;
  _panelHost = document.createElement('div');
  _panelHost.setAttribute('data-studio-v3-foliage-panel-host', '');
  document.body.appendChild(_panelHost);
  _panelRoot = createRoot(_panelHost);
  return _panelHost;
}

function renderPanel() {
  if (!_panelRoot) return;
  if (!_panelOpen) { _panelRoot.render(null); return; }
  _panelRoot.render(
    React.createElement(FoliagePanel, {
      onCloseRequest: () => panelClose(),
    })
  );
}

function panelOpen() {
  mountPanelHost();
  _panelOpen = true;
  renderPanel();
  return { ok: true, open: true };
}
function panelClose() {
  _panelOpen = false;
  renderPanel();
  return { ok: true, open: false };
}
function panelToggle() {
  return _panelOpen ? panelClose() : panelOpen();
}

// ─── Op registration helper ──────────────────────────────────────────
function reg(name, fn, description) {
  if (typeof window === 'undefined') return;
  window[name] = fn;
  const doReg = () => {
    if (typeof window.__studioCommandRegister !== 'function') return false;
    try {
      window.__studioCommandRegister(name, fn, { category: 'foliage', description });
      return true;
    } catch (_) { return false; }
  };
  if (!doReg()) {
    // Palette may not be live yet (autoload races registerV3Api()).
    setTimeout(doReg, 0);
  }
}

// ─── Install ─────────────────────────────────────────────────────────
export function installFoliage() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioFoliageInstalled) return { ok: true, alreadyInstalled: true };
  _installed = true;
  window.__studioFoliageInstalled = true;

  // ── Scatter primitives ───────────────────────────────────────────────
  reg('__studioFoliageScatterOnSurface',
    (sourceUuid, targetUuid, count, opts) =>
      scatterOnSurface(sourceUuid, targetUuid, count, opts || {}),
    'Scatter the source mesh across the target surface (triangle-area-weighted).');
  reg('__studioFoliageList',
    () => listFoliage(),
    'List every foliage InstancedMesh in the scene.');
  reg('__studioFoliageDelete',
    (uuid) => deleteFoliage(uuid),
    'Remove a foliage scatter (and its LOD low partner if any).');
  reg('__studioFoliageFind',
    (uuid) => {
      const m = findFoliageByUuid(uuid);
      return m ? { ok: true, uuid: m.uuid, count: m.count } : { ok: false, error: 'no foliage' };
    },
    'Look up a foliage InstancedMesh by uuid.');

  // ── LOD ──────────────────────────────────────────────────────────────
  reg('__studioFoliageSetupLOD',
    (scatterUuid, lowMeshUuid, distance) =>
      setupLOD(scatterUuid, lowMeshUuid, distance),
    'Bind a low-poly LOD twin to a foliage scatter; distance triggers swap.');
  reg('__studioFoliageRemoveLOD',
    (scatterUuid) => removeLOD(scatterUuid),
    'Remove the LOD twin and stop the per-frame swap tick.');
  reg('__studioFoliageSetLODDistance',
    (scatterUuid, distance) => setLODDistance(scatterUuid, distance),
    'Update the LOD swap distance threshold.');
  reg('__studioFoliageListLOD',
    () => listLOD(),
    'List every active foliage LOD pair.');

  // ── Wind ─────────────────────────────────────────────────────────────
  reg('__studioFoliageSetWind',
    (scatterUuid, strength) => setWind(scatterUuid, strength),
    'Wind sway — gentle sin oscillation on per-instance Y rotation.');
  reg('__studioFoliageClearWind',
    (scatterUuid) => clearWind(scatterUuid),
    'Stop wind sway for a foliage scatter.');
  reg('__studioFoliageListWind',
    () => listWind(),
    'List every wind-active foliage scatter.');

  // ── Paint mode ───────────────────────────────────────────────────────
  reg('__studioFoliageEnterPaintMode',
    (scatterUuid, opts) => enterPaintMode(scatterUuid, opts || {}),
    'Enter paint mode: drag to add clusters, shift-drag to remove.');
  reg('__studioFoliageExitPaintMode',
    () => exitPaintMode(),
    'Exit paint mode; restores orbit controls + cursor.');
  reg('__studioFoliagePaintStatus',
    () => paintModeStatus(),
    'Current paint-mode state (active flag + brush params).');
  reg('__studioFoliagePaintAddAt',
    (scatterUuid, worldXYZ, opts) => addAt(scatterUuid, worldXYZ, opts || {}),
    'Programmatic: add a cluster at a world point (tests + scripts).');
  reg('__studioFoliagePaintRemoveAt',
    (scatterUuid, worldXYZ, opts) => removeAt(scatterUuid, worldXYZ, opts || {}),
    'Programmatic: remove nearest N at a world point.');

  // ── Panel ────────────────────────────────────────────────────────────
  reg('__studioFoliagePanelOpen', panelOpen,
    'Open the foliage side panel.');
  reg('__studioFoliagePanelClose', panelClose,
    'Close the foliage side panel.');
  reg('__studioFoliagePanelToggle', panelToggle,
    'Toggle the foliage side panel.');

  return { ok: true, alreadyInstalled: false };
}

export function uninstallFoliage() {
  if (typeof window === 'undefined') return { ok: false };
  if (_panelOpen) { try { panelClose(); } catch (_) {} }
  const names = [
    '__studioFoliageScatterOnSurface', '__studioFoliageList', '__studioFoliageDelete', '__studioFoliageFind',
    '__studioFoliageSetupLOD', '__studioFoliageRemoveLOD', '__studioFoliageSetLODDistance', '__studioFoliageListLOD',
    '__studioFoliageSetWind', '__studioFoliageClearWind', '__studioFoliageListWind',
    '__studioFoliageEnterPaintMode', '__studioFoliageExitPaintMode', '__studioFoliagePaintStatus',
    '__studioFoliagePaintAddAt', '__studioFoliagePaintRemoveAt',
    '__studioFoliagePanelOpen', '__studioFoliagePanelClose', '__studioFoliagePanelToggle',
  ];
  for (const k of names) {
    try { delete window[k]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(k); } catch (_) {}
    }
  }
  _installed = false;
  window.__studioFoliageInstalled = false;
  return { ok: true };
}
