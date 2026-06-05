// ArchDisc Studio V3 — voxel editor installer.
//
// installVoxel() is idempotent. It:
//   • owns the singleton Volume instance + the merged-mesh handle
//   • exposes the window.__studioVoxel* op surface (see slice brief)
//   • mounts the VoxelPanel React side widget into a body-attached host
//     so we never touch StudioShellV3.jsx
//   • registers every op with the V3 command palette under the 'voxel'
//     category
//   • wires the pointer dragger so click-to-paint / shift+click-to-erase
//     works on the live volume mesh

import React from 'react';
import { createRoot } from 'react-dom/client';

import { Volume } from './volume.js';
import { rebuildMesh } from './mesh.js';
import { exportObj, exportPly } from './exportObj.js';
import {
  PALETTE_SIZE,
  getPalette, getActiveIdx, setActiveIdx,
  setPaletteEntry, resetPalette,
} from './palette.js';
import * as dragger from './dragger.js';
import VoxelPanel from './VoxelPanel.jsx';

let _installed = false;

// ─── Singleton voxel state ────────────────────────────────────────────
const _vox = {
  volume: null,
  mesh: null,                  // the THREE.Mesh in the scene
  cellSize: 0.1,
  defaultSize: [16, 16, 16],   // used by panel inputs on first open
};

function getScene() {
  return (typeof window !== 'undefined') ? window.__archdiscScene : null;
}

// ─── Volume lifecycle ─────────────────────────────────────────────────
function ensureVolume(sx, sy, sz, cellSize) {
  if (sx == null) sx = _vox.defaultSize[0];
  if (sy == null) sy = _vox.defaultSize[1];
  if (sz == null) sz = _vox.defaultSize[2];
  if (cellSize == null) cellSize = _vox.cellSize;
  _vox.volume = new Volume(sx, sy, sz);
  _vox.defaultSize = [_vox.volume.sizeX, _vox.volume.sizeY, _vox.volume.sizeZ];
  _vox.cellSize = Number(cellSize) > 0 ? cellSize : 0.1;
  rebuildMeshInScene();
  return { ok: true, uuid: _vox.mesh ? _vox.mesh.uuid : null,
    sizeX: _vox.volume.sizeX, sizeY: _vox.volume.sizeY, sizeZ: _vox.volume.sizeZ };
}

function removeCurrentMeshFromScene() {
  const scene = getScene();
  if (!scene || !_vox.mesh) return;
  scene.remove(_vox.mesh);
  try { _vox.mesh.geometry.dispose(); } catch (_) {}
  try { _vox.mesh.material.dispose(); } catch (_) {}
  _vox.mesh = null;
}

function rebuildMeshInScene() {
  const scene = getScene();
  if (!scene || !_vox.volume) {
    return { ok: false, verts: 0, voxels: 0 };
  }
  // Preserve world transform across rebuilds so the user's pose sticks.
  let pos = null, rot = null, scl = null;
  if (_vox.mesh) {
    pos = _vox.mesh.position.clone();
    rot = _vox.mesh.rotation.clone();
    scl = _vox.mesh.scale.clone();
  }
  removeCurrentMeshFromScene();
  const palette = getPalette();
  const mesh = rebuildMesh(_vox.volume, palette, _vox.cellSize);
  if (pos) mesh.position.copy(pos);
  if (rot) mesh.rotation.copy(rot);
  if (scl) mesh.scale.copy(scl);
  scene.add(mesh);
  _vox.mesh = mesh;
  const verts = mesh.geometry.attributes.position
    ? mesh.geometry.attributes.position.count : 0;
  return { ok: true, uuid: mesh.uuid, verts, voxels: _vox.volume.filled };
}

// ─── Op wrappers ──────────────────────────────────────────────────────
function opCreate(sx, sy, sz, cellSize) {
  return ensureVolume(sx, sy, sz, cellSize);
}

function opSet(x, y, z, paletteIdx) {
  if (!_vox.volume) ensureVolume();
  const idx = (paletteIdx == null) ? getActiveIdx() : paletteIdx;
  const changed = _vox.volume.set(x, y, z, idx);
  return { ok: true, changed, x, y, z, idx };
}

function opGet(x, y, z) {
  if (!_vox.volume) return { ok: false, error: 'no volume', idx: 0 };
  return { ok: true, idx: _vox.volume.get(x, y, z) };
}

function opClear() {
  if (!_vox.volume) ensureVolume();
  _vox.volume.clear();
  rebuildMeshInScene();
  return { ok: true };
}

function opSetActivePaletteIdx(idx) {
  const r = setActiveIdx(idx);
  if (_open) renderPanel();
  return r;
}

function opSetPaletteEntry(idx, hex) {
  const r = setPaletteEntry(idx, hex);
  // After a palette edit we want any voxels of that idx to display the
  // new colour, so rebuild the merged mesh.
  if (r && r.ok) rebuildMeshInScene();
  if (_open) renderPanel();
  return r;
}

function opGetPalette() {
  return { ok: true, palette: getPalette(), active: getActiveIdx(), size: PALETTE_SIZE };
}

function opRebuildMesh() {
  if (!_vox.volume) ensureVolume();
  const r = rebuildMeshInScene();
  if (_open) renderPanel();
  return r;
}

function opExportObj() {
  if (!_vox.volume) return { ok: false, error: 'no volume' };
  const text = exportObj(_vox.volume, _vox.cellSize);
  return { ok: true, text, voxels: _vox.volume.filled };
}

function opExportPly() {
  if (!_vox.volume) return { ok: false, error: 'no volume' };
  const text = exportPly(_vox.volume, _vox.cellSize);
  return { ok: true, text, voxels: _vox.volume.filled };
}

function opExportJson() {
  if (!_vox.volume) return { ok: false, error: 'no volume' };
  const json = _vox.volume.toJSON();
  json.cellSize = _vox.cellSize;
  json.palette = getPalette().slice(1).map(([r, g, b]) => {
    const f = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
    return `#${f(r)}${f(g)}${f(b)}`;
  });
  return { ok: true, json };
}

function opImportJson(json) {
  if (!json) return { ok: false, error: 'no json' };
  if (!_vox.volume) ensureVolume(json.sizeX, json.sizeY, json.sizeZ, json.cellSize);
  try {
    _vox.volume.fromJSON(json);
    if (json.cellSize) _vox.cellSize = +json.cellSize || _vox.cellSize;
    if (Array.isArray(json.palette)) {
      json.palette.forEach((hex, i) => {
        try { setPaletteEntry(1 + i, hex); } catch (_) {}
      });
    }
    rebuildMeshInScene();
    if (_open) renderPanel();
    return { ok: true, voxels: _vox.volume.filled };
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
}

// ─── Panel lifecycle ──────────────────────────────────────────────────
let _host = null;
let _root = null;
let _open = false;
let _paintEnabled = false;

function mountHost() {
  if (typeof document === 'undefined') return null;
  if (_host) return _host;
  _host = document.createElement('div');
  _host.setAttribute('data-studio-v3-voxel-host', '');
  document.body.appendChild(_host);
  _root = createRoot(_host);
  return _host;
}

function renderPanel() {
  if (!_root) return;
  if (!_open) { _root.render(null); return; }
  _root.render(
    React.createElement(VoxelPanel, {
      getActiveIdx: () => getActiveIdx(),
      setActive: (i) => { setActiveIdx(i); renderPanel(); },
      getPalette: () => getPalette(),
      setPaletteEntry: (i, hex) => { opSetPaletteEntry(i, hex); },
      getDims: () => ({
        sizeX: _vox.volume ? _vox.volume.sizeX : _vox.defaultSize[0],
        sizeY: _vox.volume ? _vox.volume.sizeY : _vox.defaultSize[1],
        sizeZ: _vox.volume ? _vox.volume.sizeZ : _vox.defaultSize[2],
      }),
      createVolume: (sx, sy, sz, cs) => { ensureVolume(sx, sy, sz, cs); renderPanel(); },
      clearVolume: () => { opClear(); renderPanel(); },
      getPaintEnabled: () => _paintEnabled,
      setPaintEnabled: (on) => {
        _paintEnabled = !!on;
        dragger.setEnabled(_paintEnabled);
        renderPanel();
      },
      getCellSize: () => _vox.cellSize,
      setCellSize: (cs) => {
        _vox.cellSize = Number(cs) > 0 ? cs : 0.1;
        rebuildMeshInScene();
        renderPanel();
      },
      exportObj: () => opExportObj(),
      exportJson: () => opExportJson(),
      importJson: (j) => { opImportJson(j); renderPanel(); },
      getStats: () => {
        const vol = _vox.volume;
        const verts = (_vox.mesh && _vox.mesh.geometry.attributes.position)
          ? _vox.mesh.geometry.attributes.position.count : 0;
        return {
          voxels: vol ? vol.filled : 0,
          verts,
          sizeX: vol ? vol.sizeX : 0,
          sizeY: vol ? vol.sizeY : 0,
          sizeZ: vol ? vol.sizeZ : 0,
        };
      },
      onCloseRequest: () => panelClose(),
    })
  );
}

function panelOpen() {
  if (!_vox.volume) ensureVolume();
  mountHost();
  _open = true;
  renderPanel();
  return { ok: true, open: true };
}
function panelClose() { _open = false; renderPanel(); return { ok: true, open: false }; }
function panelToggle() { return _open ? panelClose() : panelOpen(); }

// ─── Op registration ──────────────────────────────────────────────────
function reg(name, fn, description) {
  if (typeof window === 'undefined') return;
  window[name] = fn;
  const tryReg = () => {
    if (typeof window.__studioCommandRegister !== 'function') return false;
    try {
      window.__studioCommandRegister(name, fn, { category: 'voxel', description });
      return true;
    } catch (_) { return false; }
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
  '__studioVoxelCreate',
  '__studioVoxelSet',
  '__studioVoxelGet',
  '__studioVoxelClear',
  '__studioVoxelSetActivePaletteIdx',
  '__studioVoxelSetPaletteEntry',
  '__studioVoxelGetPalette',
  '__studioVoxelResetPalette',
  '__studioVoxelRebuildMesh',
  '__studioVoxelExportObj',
  '__studioVoxelExportPly',
  '__studioVoxelExportJson',
  '__studioVoxelImportJson',
  '__studioVoxelSetPaintEnabled',
  '__studioVoxelIsPaintEnabled',
  '__studioVoxelSimulateClick',
  '__studioVoxelGetActiveMeshUuid',
  '__studioVoxelGetStats',
  '__studioVoxelPanelOpen',
  '__studioVoxelPanelClose',
  '__studioVoxelPanelToggle',
];

// ─── Install / uninstall ──────────────────────────────────────────────
export function installVoxel() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, alreadyInstalled: true };
  _installed = true;

  // Wire the dragger to our singleton state. We pass closures so the
  // dragger always sees the live volume / mesh / palette idx without
  // having to re-install when those change.
  dragger.install({
    getVolume: () => _vox.volume,
    getCellSize: () => _vox.cellSize,
    getMesh: () => _vox.mesh,
    getActiveIdx: () => getActiveIdx(),
    onSet: (x, y, z, idx) => {
      if (_vox.volume) _vox.volume.set(x, y, z, idx);
    },
    rebuild: () => { rebuildMeshInScene(); if (_open) renderPanel(); },
  });

  reg('__studioVoxelCreate', (sx, sy, sz, cs) => opCreate(sx, sy, sz, cs),
    'Create a fresh voxel volume (sizeX, sizeY, sizeZ, cellSize) and place an empty mesh in the scene.');
  reg('__studioVoxelSet', (x, y, z, idx) => opSet(x, y, z, idx),
    'Set the palette index at cell (x,y,z). Pass 0 to clear; omit idx to use the active palette colour.');
  reg('__studioVoxelGet', (x, y, z) => opGet(x, y, z),
    'Read the palette index at cell (x,y,z); 0 = empty.');
  reg('__studioVoxelClear', () => opClear(), 'Clear every cell in the current voxel volume.');
  reg('__studioVoxelSetActivePaletteIdx', (i) => opSetActivePaletteIdx(i),
    'Set the active palette index used by paint clicks (1..64).');
  reg('__studioVoxelSetPaletteEntry', (i, hex) => opSetPaletteEntry(i, hex),
    'Overwrite palette slot i with a hex colour like "#ff8800". Rebuilds the mesh.');
  reg('__studioVoxelGetPalette', () => opGetPalette(),
    'Read the 64-entry voxel palette + active index.');
  reg('__studioVoxelResetPalette', () => { resetPalette(); rebuildMeshInScene(); return { ok: true }; },
    'Reset the palette to the built-in 16x4 HSL grid.');
  reg('__studioVoxelRebuildMesh', () => opRebuildMesh(),
    'Rebuild the merged voxel mesh from the current volume state.');
  reg('__studioVoxelExportObj', () => opExportObj(),
    'Export the current voxel volume as a Wavefront OBJ text string.');
  reg('__studioVoxelExportPly', () => opExportPly(),
    'Export the current voxel volume as Stanford PLY (ASCII, vertex colours).');
  reg('__studioVoxelExportJson', () => opExportJson(),
    'Export the current voxel volume + palette + cell size as a JSON-serializable object.');
  reg('__studioVoxelImportJson', (j) => opImportJson(j),
    'Load a voxel volume from a JSON payload produced by __studioVoxelExportJson.');
  reg('__studioVoxelSetPaintEnabled', (on) => {
    _paintEnabled = !!on;
    dragger.setEnabled(_paintEnabled);
    if (_open) renderPanel();
    return { ok: true, enabled: _paintEnabled };
  }, 'Enable / disable click-to-paint on the renderer canvas.');
  reg('__studioVoxelIsPaintEnabled', () => ({ ok: true, enabled: _paintEnabled }),
    'Probe whether click-to-paint is currently enabled.');
  reg('__studioVoxelSimulateClick', (x, y, z, shift) => dragger.simulateClick(x, y, z, shift),
    'Test hook: simulate a paint click at integer cell coords (shift=true removes).');
  reg('__studioVoxelGetActiveMeshUuid', () => ({ ok: true, uuid: _vox.mesh ? _vox.mesh.uuid : null }),
    'Return the THREE.Object3D UUID of the current voxel volume mesh.');
  reg('__studioVoxelGetStats', () => {
    const vol = _vox.volume;
    const verts = (_vox.mesh && _vox.mesh.geometry.attributes.position)
      ? _vox.mesh.geometry.attributes.position.count : 0;
    return {
      ok: true,
      voxels: vol ? vol.filled : 0,
      verts,
      sizeX: vol ? vol.sizeX : 0,
      sizeY: vol ? vol.sizeY : 0,
      sizeZ: vol ? vol.sizeZ : 0,
      cellSize: _vox.cellSize,
    };
  }, 'Read voxel volume stats (filled count, vert count, dims, cell size).');

  reg('__studioVoxelPanelOpen',   panelOpen,   'Open the voxel editor side panel.');
  reg('__studioVoxelPanelClose',  panelClose,  'Close the voxel editor side panel.');
  reg('__studioVoxelPanelToggle', panelToggle, 'Toggle the voxel editor side panel.');

  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallVoxel() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  dragger.uninstall();
  removeCurrentMeshFromScene();
  _vox.volume = null;
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

export default installVoxel;
