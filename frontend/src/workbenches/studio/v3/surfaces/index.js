// ArchDisc Studio V3 — Plasticity-style surface op installer.
//
// installSurfaces() (idempotent) wires:
//   1. The window.__studioSurface* op surface (6 ops + 3 panel ops).
//   2. The SurfacePanel React component into a body-attached host
//      (we never touch StudioShellV3.jsx).
//   3. Each op into the command palette under category 'edit' (per
//      slice contract — surface ops complement the slice-682 edit/
//      module and the slice-NNN editmore/ module).
//
// Op surface (matches the slice contract):
//   __studioSurfaceFilletEdge(meshUuid, edgeKey, radius, segments)
//   __studioSurfaceChamferEdge(meshUuid, edgeKey, distance)
//   __studioSurfaceOffset(meshUuid, distance)        → { ok, uuid }
//   __studioSurfaceShell(meshUuid, thickness)        → { ok, uuid }
//   __studioSurfaceUnfold(meshUuid, faceIndices)     → { ok, uuid }
//   __studioSurfaceStitch(meshUuidA, loopA, meshUuidB, loopB)
//   __studioSurfacePanelOpen() / Close() / Toggle()

import React from 'react';

import SurfacePanel from './SurfacePanel.jsx';
import { filletEdge }    from './fillet.js';
import { chamferEdge }   from './chamfer.js';
import { offsetSurface } from './offset.js';
import { shellSurface }  from './shell.js';
import { unfoldStrip }   from './unfold.js';
import { stitchLoops }   from './stitch.js';

import { registerOps, unregisterOps } from '../common/registry.js';
import { mountPanel, unmountPanel } from '../common/panel.js';

let _installed = false;
let _panelRec = null;
let _open = false;
let _pinnedB = null;

// ── Op wrappers ──────────────────────────────────────────────────────────
function __studioSurfaceFilletEdge(meshUuid, edgeKey, radius, segments) {
  return filletEdge(meshUuid, edgeKey, radius, segments);
}
function __studioSurfaceChamferEdge(meshUuid, edgeKey, distance) {
  return chamferEdge(meshUuid, edgeKey, distance);
}
function __studioSurfaceOffset(meshUuid, distance, opts) {
  return offsetSurface(meshUuid, distance, opts);
}
function __studioSurfaceShell(meshUuid, thickness) {
  return shellSurface(meshUuid, thickness);
}
function __studioSurfaceUnfold(meshUuid, faceIndices) {
  return unfoldStrip(meshUuid, faceIndices);
}
function __studioSurfaceStitch(meshUuidA, loopA, meshUuidB, loopB) {
  return stitchLoops(meshUuidA, loopA, meshUuidB, loopB);
}

// ── Panel lifecycle ──────────────────────────────────────────────────────
function ensureHost() {
  if (_panelRec) return _panelRec;
  _panelRec = mountPanel('surface');
  return _panelRec;
}

function getSelectedUuid() {
  if (typeof window === 'undefined') return null;
  if (typeof window.__studioSelectedMesh === 'function') {
    try {
      const m = window.__studioSelectedMesh();
      return m ? m.uuid : null;
    } catch (_) { return null; }
  }
  return null;
}

function pinSelectionB() {
  const u = getSelectedUuid();
  if (u) _pinnedB = u;
  return _pinnedB;
}

async function apply(opId, params) {
  if (opId === 'fillet') {
    return __studioSurfaceFilletEdge(params.uuid, params.edgeKey, params.radius, params.segments);
  }
  if (opId === 'chamfer') {
    return __studioSurfaceChamferEdge(params.uuid, params.edgeKey, params.distance);
  }
  if (opId === 'offset') {
    return __studioSurfaceOffset(params.uuid, params.distance);
  }
  if (opId === 'shell') {
    return __studioSurfaceShell(params.uuid, params.thickness);
  }
  if (opId === 'unfold') {
    return __studioSurfaceUnfold(params.uuid, params.faceIndices);
  }
  if (opId === 'stitch') {
    return __studioSurfaceStitch(params.uuidA, [], params.uuidB, []);
  }
  return { ok: false, error: 'unknown op' };
}

function renderPanel() {
  if (!_panelRec) return;
  if (!_open) { _panelRec.render(null); return; }
  _panelRec.render(
    React.createElement(SurfacePanel, {
      getSelectedUuid,
      apply: async (id, p) => {
        const r = await apply(id, p);
        renderPanel();
        return r;
      },
      pinSelectionB: () => { pinSelectionB(); renderPanel(); },
      pinnedB: _pinnedB,
      onCloseRequest: () => __studioSurfacePanelClose(),
    }),
  );
}

function __studioSurfacePanelOpen()   { ensureHost(); _open = true;  renderPanel(); return { ok: true, open: true }; }
function __studioSurfacePanelClose()  { _open = false; renderPanel(); return { ok: true, open: false }; }
function __studioSurfacePanelToggle() { return _open ? __studioSurfacePanelClose() : __studioSurfacePanelOpen(); }

// ── Op registration ──────────────────────────────────────────────────────
const OP_MAP = {
  __studioSurfaceFilletEdge:   [__studioSurfaceFilletEdge,   'Plasticity-style fillet edge: insert a quarter-arc transition between two adjacent faces (N segs).'],
  __studioSurfaceChamferEdge:  [__studioSurfaceChamferEdge,  'Plasticity-style chamfer: single flat bevel between two faces sharing the given edge.'],
  __studioSurfaceOffset:       [__studioSurfaceOffset,       'Offset surface: duplicate the mesh and push every vertex along its normal by `distance` (new mesh in scene).'],
  __studioSurfaceShell:        [__studioSurfaceShell,        'Shell: build an inner offset + outer skin + side walls into a hollow thick-walled solid.'],
  __studioSurfaceUnfold:       [__studioSurfaceUnfold,       'Unfold strip: flatten a connected list of triangles into the XY plane (LSCM-style).'],
  __studioSurfaceStitch:       [__studioSurfaceStitch,       'Stitch loops: sew two edge loops on different meshes with a bridging quad strip.'],
  __studioSurfacePanelOpen:    [__studioSurfacePanelOpen,    'Open the surface-ops side panel.'],
  __studioSurfacePanelClose:   [__studioSurfacePanelClose,   'Close the surface-ops side panel.'],
  __studioSurfacePanelToggle:  [__studioSurfacePanelToggle,  'Toggle the surface-ops side panel.'],
};

const OP_NAMES = Object.keys(OP_MAP);

export function installSurfaces() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, alreadyInstalled: true, installed: OP_NAMES.length };
  registerOps(OP_MAP, 'edit');
  _installed = true;

  // Esc closes the panel, matching the rest of V3's panel UX.
  const onKey = (e) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.key === 'Escape' && _open) { __studioSurfacePanelClose(); e.preventDefault(); }
  };
  try { window.addEventListener('keydown', onKey); } catch (_) {}

  return { ok: true, installed: OP_NAMES.length, names: OP_NAMES };
}

export function uninstallSurfaces() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  unregisterOps(OP_NAMES);
  unmountPanel('surface');
  _panelRec = null;
  _open = false;
  _pinnedB = null;
  _installed = false;
  return { ok: true };
}

export function isInstalled() { return _installed; }
export const opNames = OP_NAMES;
export default installSurfaces;
