// ArchDisc Studio V3 — Mari-style projection-painting installer.
//
// `installPaintProj()` wires every window.__studioPaintProj* op, mounts
// the React panel into a body-attached host (no StudioShellV3.jsx
// changes), and auto-registers every op with the V3 command palette
// under category 'texpaint'.
//
// Idempotent — guarded by window.__studioPaintProjInstalled.

import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  install as installDragger, uninstall as uninstallDragger,
  enterPaintMode, exitPaintMode, setBrush, getBrush,
  isActive, getStats, _injectClickAt,
} from './dragger.js';
import { stampAt, clearCanvas, exportCanvasDataUrl, DEFAULT_TEX_SIZE } from './canvasPaint.js';
import { pickAtScreen } from './raycaster.js';
import { projectImageFromCamera } from './projectImage.js';
import PaintPanel from './PaintPanel.jsx';

let _installed = false;
let _host = null;
let _root = null;
let _open = false;

function _getSelectedMesh() {
  if (typeof window === 'undefined') return null;
  if (typeof window.__studioSelectedMesh === 'function') return window.__studioSelectedMesh();
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}

function _meshByUuid(uuid) {
  if (!uuid) return _getSelectedMesh();
  if (typeof window === 'undefined') return null;
  const vp = window.__archdiscViewport;
  if (!vp || !vp.scene) return null;
  let found = null;
  vp.scene.traverse((o) => { if (o.uuid === uuid) found = o; });
  return found;
}

function _mountHost() {
  if (typeof document === 'undefined') return null;
  if (_host) return _host;
  _host = document.createElement('div');
  _host.setAttribute('data-studio-v3-paintproj-host', '');
  document.body.appendChild(_host);
  _root = createRoot(_host);
  return _host;
}

function _renderPanel() {
  if (!_root) return;
  if (!_open) { _root.render(null); return; }
  _root.render(
    React.createElement(PaintPanel, {
      getSelectedMesh: _getSelectedMesh,
      getBrush,
      onSetBrush: setBrush,
      isActive,
      onEnterPaintMode: enterPaintMode,
      onExitPaintMode:  exitPaintMode,
      onProjectImage: async (dataUrl) => {
        const m = _getSelectedMesh();
        if (!m) return;
        await projectImageFromCamera(m.uuid, dataUrl);
      },
      onClear: () => {
        const m = _getSelectedMesh();
        if (!m) return;
        clearCanvas(m, '#ffffff');
      },
      onCloseRequest: panelClose,
    })
  );
}

function panelOpen()   { _mountHost(); _open = true;  _renderPanel(); return { ok: true, open: true }; }
function panelClose()  { _open = false; _renderPanel(); return { ok: true, open: false }; }
function panelToggle() { return _open ? panelClose() : panelOpen(); }

function _reg(name, fn, description) {
  window[name] = fn;
  const tryReg = () => {
    if (typeof window.__studioCommandRegister !== 'function') return false;
    try { window.__studioCommandRegister(name, fn, { category: 'texpaint', description }); return true; }
    catch (_) { return false; }
  };
  if (!tryReg()) setTimeout(tryReg, 0);
}

export function installPaintProj() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (window.__studioPaintProjInstalled) return { ok: true, alreadyInstalled: true };
  window.__studioPaintProjInstalled = true;

  installDragger();

  // ── Paint mode toggles ───────────────────────────────────────────────
  _reg('__studioPaintProjEnterPaintMode', () => enterPaintMode(),
    'Enter Mari-style projection paint mode. Disables orbit; clicks paint.');
  _reg('__studioPaintProjExitPaintMode', () => exitPaintMode(),
    'Exit paint mode. Restores orbit + cursor.');
  _reg('__studioPaintProjIsActive', () => ({ ok: true, active: !!isActive() }),
    'Report whether paint mode is currently active.');

  // ── Brush settings ───────────────────────────────────────────────────
  _reg('__studioPaintProjSetBrush', (partial) => setBrush(partial || {}),
    'Set brush settings ({ size, color, opacity, hardness }).');
  _reg('__studioPaintProjGetBrush', () => ({ ok: true, brush: getBrush() }),
    'Read the current brush settings.');

  // ── Stamping ─────────────────────────────────────────────────────────
  _reg('__studioPaintProjStampAtUV', (meshUuid, uvX, uvY, color, size, opacity, hardness) => {
    const m = _meshByUuid(meshUuid);
    if (!m) return { ok: false, error: 'no mesh' };
    const b = getBrush();
    return stampAt(
      m, [Number(uvX), Number(uvY)],
      color || b.color,
      typeof size === 'number' ? size : b.size,
      typeof opacity === 'number' ? opacity : b.opacity,
      typeof hardness === 'number' ? hardness : b.hardness,
    );
  }, 'Stamp the brush at (uvX, uvY) on the given mesh\'s mat.map.');

  _reg('__studioPaintProjStampAtScreen', (clientX, clientY) => {
    const r = pickAtScreen(Number(clientX), Number(clientY));
    if (!r || !r.ok) return r || { ok: false };
    const b = getBrush();
    const stamp = stampAt(r.mesh, r.uv, b.color, b.size, b.opacity, b.hardness);
    return { ok: !!(stamp && stamp.ok), uv: r.uv, meshUuid: r.meshUuid, ...stamp };
  }, 'Pick at a screen (clientX, clientY) and stamp the brush at the hit UV.');

  _reg('__studioPaintProjPickAtScreen', (clientX, clientY) =>
    pickAtScreen(Number(clientX), Number(clientY)),
    'Raycast at (clientX, clientY) and return { mesh, uv, faceIdx, worldPos }.');

  // Programmatic dragger injection — useful for tests.
  _reg('__studioPaintProjInjectClick', (clientX, clientY) =>
    _injectClickAt(Number(clientX), Number(clientY)),
    'Inject a synthetic paint click at (clientX, clientY) while paint mode is active.');

  // ── Image projection ─────────────────────────────────────────────────
  _reg('__studioPaintProjProjectImage', async (meshUuid, imageDataUrl, opts) => {
    const r = await projectImageFromCamera(meshUuid || (_getSelectedMesh() && _getSelectedMesh().uuid), imageDataUrl, opts || {});
    return r;
  }, 'Project a 2D image onto a mesh\'s mat.map from the current camera viewpoint.');

  // ── Maintenance ──────────────────────────────────────────────────────
  _reg('__studioPaintProjClear', (meshUuid, fillStyle) => {
    const m = _meshByUuid(meshUuid);
    if (!m) return { ok: false, error: 'no mesh' };
    return clearCanvas(m, fillStyle || '#ffffff');
  }, 'Wipe the projection-paint canvas back to a solid colour.');

  _reg('__studioPaintProjExportDataUrl', (meshUuid) => {
    const m = _meshByUuid(meshUuid);
    if (!m) return { ok: false, error: 'no mesh' };
    const url = exportCanvasDataUrl(m);
    if (!url) return { ok: false, error: 'no canvas' };
    return { ok: true, dataUrl: url };
  }, 'Export the projection-paint canvas as a PNG data URL.');

  _reg('__studioPaintProjStats', () => ({ ok: true, stats: getStats() }),
    'Read dragger stats (downs / moves / hits / misses).');

  _reg('__studioPaintProjGetTexSize', () => ({ ok: true, size: DEFAULT_TEX_SIZE }),
    'Return the default paint texture resolution (1024).');

  // ── Panel toggles ────────────────────────────────────────────────────
  _reg('__studioPaintProjPanelOpen',   panelOpen,   'Open the projection-paint side panel.');
  _reg('__studioPaintProjPanelClose',  panelClose,  'Close the projection-paint side panel.');
  _reg('__studioPaintProjPanelToggle', panelToggle, 'Toggle the projection-paint side panel.');

  // Esc closes the panel (only when nothing's focused).
  const onKey = (e) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.key === 'Escape' && _open) { panelClose(); e.preventDefault(); }
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);

  _installed = true;
  return { ok: true, alreadyInstalled: false };
}

export function uninstallPaintProj() {
  if (typeof window === 'undefined') return { ok: false };
  for (const k of [
    '__studioPaintProjEnterPaintMode', '__studioPaintProjExitPaintMode', '__studioPaintProjIsActive',
    '__studioPaintProjSetBrush', '__studioPaintProjGetBrush',
    '__studioPaintProjStampAtUV', '__studioPaintProjStampAtScreen', '__studioPaintProjPickAtScreen',
    '__studioPaintProjInjectClick',
    '__studioPaintProjProjectImage',
    '__studioPaintProjClear', '__studioPaintProjExportDataUrl', '__studioPaintProjStats',
    '__studioPaintProjGetTexSize',
    '__studioPaintProjPanelOpen', '__studioPaintProjPanelClose', '__studioPaintProjPanelToggle',
  ]) {
    try { delete window[k]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(k); } catch (_) {}
    }
  }
  uninstallDragger();
  if (_root) { try { _root.unmount(); } catch (_) {} _root = null; }
  if (_host && _host.parentNode) _host.parentNode.removeChild(_host);
  _host = null; _open = false;
  window.__studioPaintProjInstalled = false;
  _installed = false;
  return { ok: true };
}

export default installPaintProj;
