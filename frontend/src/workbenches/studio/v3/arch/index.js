// ArchDisc Studio V3 — Architecture toolkit installer.
//
// installArch() is idempotent. It:
//   • attaches the window.__studioArch* op surface
//   • registers every op with the V3 command palette under category 'arch'
//   • mounts the ArchPanel React component into a body-attached host so
//     we don't touch StudioShellV3.jsx
//
// Op surface:
//   __studioArchCreateWall(p1, p2, height, thickness) → { ok, uuid }
//   __studioArchCutDoor(wallUuid, atFrac, w, h)       → { ok, uuid, frameUuid }
//   __studioArchCutWindow(wallUuid, atFrac, w, h, sillH) → { ok, uuid, glassUuid }
//   __studioArchCreateFloor(polygon, thickness)       → { ok, uuid }
//   __studioArchCreateGableRoof(polygon, ridgeH, oh)  → { ok, uuid }
//   __studioArchAddDimensionLine(p1, p2, opts)        → { ok, uuid, distance }
//   __studioArchGenerateBuilding(footprint, floors, wallH, opts) → { ok, uuids:[] }
//   __studioArchPanelOpen()/Close()/Toggle()
//   __studioArchList()                                 → { ok, items:[…] }
//   __studioArchClear()                                → { ok, removed }
//   __studioArchPickWallUuid()                         → first arch-wall uuid in selection
//
// All real boolean cuts go through window.__studioCSGDifference (slice
// 691). If that op isn't installed yet door/window cuts return an
// error rather than fall back to a fake cut.

import React from 'react';
import { mountPanel, unmountPanel } from '../common/panel.js';
import { registerOps, unregisterOps } from '../common/registry.js';

import { createWall } from './wall.js';
import { cutDoor } from './door.js';
import { cutWindow } from './window.js';
import { createFloor } from './floor.js';
import { createGableRoof } from './roof.js';
import { addDimensionLine } from './dimensions.js';
import { generateBuilding } from './building.js';

import ArchPanel from './ArchPanel.jsx';

let _installed = false;
let _panel = null;
let _open = false;

const OP_NAMES = [
  '__studioArchCreateWall',
  '__studioArchCutDoor',
  '__studioArchCutWindow',
  '__studioArchCreateFloor',
  '__studioArchCreateGableRoof',
  '__studioArchAddDimensionLine',
  '__studioArchGenerateBuilding',
  '__studioArchPanelOpen',
  '__studioArchPanelClose',
  '__studioArchPanelToggle',
  '__studioArchList',
  '__studioArchClear',
  '__studioArchPickWallUuid',
];

// ─── Scene helper ────────────────────────────────────────────────────
function _scene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}

function _push(mesh) {
  const scene = _scene();
  if (!scene || !mesh) return null;
  scene.add(mesh);
  if (typeof window !== 'undefined' && typeof window.__studioPushUndo === 'function') {
    try { window.__studioPushUndo(`arch-${mesh.userData?.archdiscStudioPrimitiveKind || 'mesh'}`); } catch (_) { /* swallow */ }
  }
  return mesh.uuid;
}

function _list() {
  const scene = _scene();
  if (!scene) return { ok: false, count: 0, items: [] };
  const items = [];
  scene.traverse((o) => {
    if (!o.userData) return;
    const k = o.userData.archdiscStudioPrimitiveKind;
    if (typeof k === 'string' && k.indexOf('arch-') === 0) {
      items.push({ uuid: o.uuid, name: o.name || '', kind: k });
    }
  });
  return {
    ok: true,
    count: items.length,
    items,
    walls: items.filter((i) => i.kind === 'arch-wall').length,
    floors: items.filter((i) => i.kind === 'arch-floor').length,
    roofs: items.filter((i) => i.kind === 'arch-roof').length,
    dimensions: items.filter((i) => i.kind === 'arch-dimension').length,
  };
}

function _clear() {
  const scene = _scene();
  if (!scene) return { ok: false };
  const victims = [];
  scene.traverse((o) => {
    if (!o.userData) return;
    const k = o.userData.archdiscStudioPrimitiveKind;
    if (typeof k === 'string' && k.indexOf('arch-') === 0) victims.push(o);
  });
  for (const o of victims) {
    if (o.parent) o.parent.remove(o);
    o.traverse?.((c) => {
      if (c.geometry && c.geometry.dispose) c.geometry.dispose();
      if (c.material) {
        const mats = Array.isArray(c.material) ? c.material : [c.material];
        for (const m of mats) {
          if (m && m.map && m.map.dispose) m.map.dispose();
          if (m && m.dispose) m.dispose();
        }
      }
    });
    if (o.geometry && o.geometry.dispose) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m && m.map && m.map.dispose) m.map.dispose();
        if (m && m.dispose) m.dispose();
      }
    }
  }
  return { ok: true, removed: victims.length };
}

function _pickWallUuid() {
  const scene = _scene();
  if (!scene) return null;
  // Prefer the currently-selected mesh if it's a wall.
  if (typeof window !== 'undefined') {
    if (typeof window.__studioSelectedMesh === 'function') {
      const s = window.__studioSelectedMesh();
      if (s && s.userData && s.userData.archdiscStudioPrimitiveKind === 'arch-wall') return s.uuid;
    }
    if (Array.isArray(window.__studioSelectedMeshesSet)) {
      for (const m of window.__studioSelectedMeshesSet) {
        if (m && m.userData && m.userData.archdiscStudioPrimitiveKind === 'arch-wall') return m.uuid;
      }
    }
  }
  // Fallback: first arch-wall in the scene.
  let hit = null;
  scene.traverse((o) => {
    if (hit) return;
    if (o.userData && o.userData.archdiscStudioPrimitiveKind === 'arch-wall') hit = o;
  });
  return hit ? hit.uuid : null;
}

// ─── Panel lifecycle ─────────────────────────────────────────────────
function _mountHost() {
  if (_panel) return _panel.host;
  _panel = mountPanel('arch');
  return _panel ? _panel.host : null;
}

function _renderPanel() {
  if (!_panel) return;
  if (!_open) { _panel.render(null); return; }
  _panel.render(
    React.createElement(ArchPanel, {
      getStatus: () => {
        const l = _list();
        return { walls: l.walls || 0, floors: l.floors || 0, roofs: l.roofs || 0, dimensions: l.dimensions || 0 };
      },
      createWall:        (p1, p2, h, th) => Promise.resolve(_opCreateWall(p1, p2, h, th)),
      cutDoor:           (u, f, w, h)    => _opCutDoor(u, f, w, h),
      cutWindow:         (u, f, w, h, s) => _opCutWindow(u, f, w, h, s),
      createFloor:       (poly, th)      => Promise.resolve(_opCreateFloor(poly, th)),
      createGableRoof:   (poly, r, oh)   => Promise.resolve(_opCreateGableRoof(poly, r, oh)),
      generateBuilding:  (f, n, h, o)    => Promise.resolve(_opGenerateBuilding(f, n, h, o)),
      addDimension:      (p1, p2, opts)  => Promise.resolve(_opAddDimensionLine(p1, p2, opts)),
      onCloseRequest: () => _panelClose(),
    })
  );
}

function _panelOpen() {
  _mountHost();
  _open = true;
  _renderPanel();
  return { ok: true, open: true };
}
function _panelClose() {
  _open = false;
  _renderPanel();
  return { ok: true, open: false };
}
function _panelToggle() { return _open ? _panelClose() : _panelOpen(); }

// ─── Op implementations (mesh creators) ──────────────────────────────
function _opCreateWall(p1, p2, height, thickness) {
  try {
    const mesh = createWall(p1, p2, height, thickness);
    const uuid = _push(mesh);
    if (_open) _renderPanel();
    return { ok: !!uuid, uuid };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

async function _opCutDoor(wallUuid, atFraction, width, height) {
  try {
    const r = await cutDoor(wallUuid, atFraction, width, height);
    if (_open) _renderPanel();
    return r;
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

async function _opCutWindow(wallUuid, atFraction, width, height, sillHeight) {
  try {
    const r = await cutWindow(wallUuid, atFraction, width, height, sillHeight);
    if (_open) _renderPanel();
    return r;
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

function _opCreateFloor(polygon, thickness) {
  try {
    const mesh = createFloor(polygon, thickness);
    const uuid = _push(mesh);
    if (_open) _renderPanel();
    return { ok: !!uuid, uuid };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

function _opCreateGableRoof(polygon, ridgeHeight, overhang) {
  try {
    const mesh = createGableRoof(polygon, ridgeHeight, overhang);
    const uuid = _push(mesh);
    if (_open) _renderPanel();
    return { ok: !!uuid, uuid };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

function _opAddDimensionLine(p1, p2, opts) {
  try {
    const r = addDimensionLine(p1, p2, opts);
    if (!r || !r.ok || !r.group) {
      return { ok: false, error: (r && r.error) || 'dimension build failed' };
    }
    const uuid = _push(r.group);
    if (_open) _renderPanel();
    return { ok: !!uuid, uuid, distance: r.distance };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

function _opGenerateBuilding(footprint, floors, wallHeight, opts) {
  try {
    const r = generateBuilding(footprint, floors, wallHeight, opts || {});
    const scene = _scene();
    if (!scene) return { ok: false, error: 'no scene' };
    for (const m of r.meshes) scene.add(m);
    if (typeof window !== 'undefined' && typeof window.__studioPushUndo === 'function') {
      try { window.__studioPushUndo('arch-building'); } catch (_) { /* swallow */ }
    }
    if (_open) _renderPanel();
    return { ok: true, uuids: r.uuids, anatomy: r.anatomy };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

// ─── Install / uninstall ─────────────────────────────────────────────
export function installArch() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, alreadyInstalled: true };
  _installed = true;

  registerOps({
    __studioArchCreateWall:        [_opCreateWall,        'Create an architectural wall between two world XZ points (extruded rectangle).'],
    __studioArchCutDoor:           [_opCutDoor,           'Real-CSG door cut into a wall (slice 691 __studioCSGDifference). Returns new wall + frame uuids.'],
    __studioArchCutWindow:         [_opCutWindow,         'Real-CSG window cut into a wall, with sill height. Adds a glass infill.'],
    __studioArchCreateFloor:       [_opCreateFloor,       'Create a floor slab from an XZ polygon and slab thickness.'],
    __studioArchCreateGableRoof:   [_opCreateGableRoof,   'Create a gable (two-pitch) roof from an XZ footprint, ridge height and overhang.'],
    __studioArchAddDimensionLine:  [_opAddDimensionLine,  'Add a labelled dimension line between two world points (arch category).'],
    __studioArchGenerateBuilding:  [_opGenerateBuilding,  'Generate a full building: walls per polygon edge × floors, slabs, gable roof.'],
    __studioArchPanelOpen:         [_panelOpen,           'Open the Architecture side panel.'],
    __studioArchPanelClose:        [_panelClose,          'Close the Architecture side panel.'],
    __studioArchPanelToggle:       [_panelToggle,         'Toggle the Architecture side panel.'],
    __studioArchList:              [_list,                'List every architecture primitive in the scene (walls/floors/roofs/dimensions).'],
    __studioArchClear:             [_clear,               'Remove every architecture primitive from the scene.'],
    __studioArchPickWallUuid:      [_pickWallUuid,        'Return a wall uuid from the current selection (or first scene wall as fallback).'],
  }, 'arch');

  // Esc closes the panel.
  if (typeof window !== 'undefined') {
    const _onKey = (e) => {
      const ae = (typeof document !== 'undefined') ? document.activeElement : null;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if (e.key === 'Escape' && _open) { _panelClose(); e.preventDefault(); }
    };
    window.addEventListener('keydown', _onKey);
  }

  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallArch() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  unregisterOps(OP_NAMES);
  if (_panel) { unmountPanel('arch'); _panel = null; }
  _open = false;
  _installed = false;
  return { ok: true };
}
