// ArchDisc Studio V3 — texpaint installer + window.__studioTexPaint* API.
//
// `installTexPaint()` wires every op surface, mounts the React side
// panel into a body-attached host (so we don't have to modify
// StudioShellV3.jsx), and registers every op with the V3 command
// palette under category 'texpaint'.
//
// Idempotent — guarded by `window.__studioTexPaintInstalled`.

import React from 'react';
import { createRoot } from 'react-dom/client';
import * as ls from './layerstack.js';
import { paintAt as _paintAt } from './paint.js';
import { apply as applySmart, listSmartMaterials, SMART_MATERIAL_NAMES } from './smartmat.js';
import { generate as genMask, MASK_KINDS } from './maskgen.js';
import LayerStackPanel from './LayerStackPanel.jsx';

let _installed = false;
let _host = null;
let _root = null;
let _open = false;

function getSelectedMesh() {
  if (typeof window === 'undefined') return null;
  if (window.__studioSelectedMesh) return window.__studioSelectedMesh();
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}

function activeMaterial() {
  const m = getSelectedMesh();
  if (!m) return null;
  return Array.isArray(m.material) ? m.material[0] : m.material;
}

function mountHost() {
  if (typeof document === 'undefined') return null;
  if (_host) return _host;
  _host = document.createElement('div');
  _host.setAttribute('data-studio-v3-texpaint-host', '');
  document.body.appendChild(_host);
  _root = createRoot(_host);
  return _host;
}

function renderPanel() {
  if (!_root) return;
  if (!_open) { _root.render(null); return; }
  _root.render(
    React.createElement(LayerStackPanel, {
      getSelectedMesh,
      listLayers: () => {
        const mat = activeMaterial();
        if (!mat) return { count: 0, layers: [] };
        return ls.listLayers(mat);
      },
      onAddFill: () => {
        const mat = activeMaterial(); if (!mat) return;
        ls.addLayer(mat, 'fill', { color: '#cccccc', name: 'Fill' });
        renderPanel();
      },
      onAddPaint: () => {
        const mat = activeMaterial(); if (!mat) return;
        ls.addLayer(mat, 'paint', { name: 'Paint' });
        renderPanel();
      },
      onAddGenerator: (kind) => {
        const mat = activeMaterial(); if (!mat) return;
        const mesh = getSelectedMesh();
        const r = genMask(kind, mesh, {});
        if (r && r.dataUrl) {
          ls.addLayer(mat, 'generator', {
            canvasDataUrl: r.dataUrl,
            blend: 'multiply', opacity: 0.6,
            name: `Mask · ${kind}`,
          });
          renderPanel();
        }
      },
      onDelete: (uuid) => {
        const mat = activeMaterial(); if (!mat) return;
        ls.deleteLayer(mat, uuid); renderPanel();
      },
      onReorder: (from, to) => {
        const mat = activeMaterial(); if (!mat) return;
        ls.reorder(mat, from, to); renderPanel();
      },
      onToggleEnabled: (uuid) => {
        const mat = activeMaterial(); if (!mat) return;
        const list = ls.listLayers(mat);
        const cur = list.layers.find((l) => l.uuid === uuid);
        ls.setEnabled(mat, uuid, cur ? !cur.enabled : true); renderPanel();
      },
      onToggleLocked: (uuid) => {
        const mat = activeMaterial(); if (!mat) return;
        const list = ls.listLayers(mat);
        const cur = list.layers.find((l) => l.uuid === uuid);
        ls.setLocked(mat, uuid, cur ? !cur.locked : true); renderPanel();
      },
      onSetOpacity: (uuid, w) => {
        const mat = activeMaterial(); if (!mat) return;
        ls.setOpacity(mat, uuid, w);
      },
      onSetBlend: (uuid, blend) => {
        const mat = activeMaterial(); if (!mat) return;
        ls.setBlend(mat, uuid, blend); renderPanel();
      },
      onBake: () => bakeOp(),
      onApplySmart: (name) => {
        const mat = activeMaterial(); if (!mat) return;
        applySmart(mat, name); bakeOp(); renderPanel();
      },
      onMaskGen: (kind) => {
        const mat = activeMaterial(); if (!mat) return;
        const mesh = getSelectedMesh();
        const r = genMask(kind, mesh, {});
        if (r && r.dataUrl) {
          ls.addLayer(mat, 'generator', {
            canvasDataUrl: r.dataUrl,
            blend: 'multiply', opacity: 0.6,
            name: `Mask · ${kind}`,
          });
          renderPanel();
        }
      },
      smartNames: SMART_MATERIAL_NAMES,
      maskKinds: MASK_KINDS,
      onCloseRequest: panelClose,
    })
  );
}

function panelOpen()   { mountHost(); _open = true;  renderPanel(); return { ok: true, open: true }; }
function panelClose()  { _open = false; renderPanel(); return { ok: true, open: false }; }
function panelToggle() { return _open ? panelClose() : panelOpen(); }

function bakeOp() {
  const mesh = getSelectedMesh();
  if (!mesh) return { ok: false, error: 'no mesh' };
  // The layerstack bake is async (it awaits image decode). Caller may
  // ignore the returned Promise; callers that need the dataUrl can
  // .then() it.
  return ls.bake(mesh);
}

function reg(name, fn, description) {
  window[name] = fn;
  const tryReg = () => {
    if (typeof window.__studioCommandRegister !== 'function') return false;
    try { window.__studioCommandRegister(name, fn, { category: 'texpaint', description }); return true; }
    catch (_) { return false; }
  };
  if (!tryReg()) setTimeout(tryReg, 0);
}

export function installTexPaint() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (window.__studioTexPaintInstalled) return { ok: true, alreadyInstalled: true };
  window.__studioTexPaintInstalled = true;

  // Layer CRUD.
  reg('__studioTexPaintLayerAdd', (kind, opts) => {
    const mat = activeMaterial();
    if (!mat) return { ok: false, error: 'no material' };
    const l = ls.addLayer(mat, kind, opts || {});
    if (!l) return { ok: false, error: 'add failed' };
    renderPanel();
    return { ok: true, uuid: l.uuid, kind: l.kind, blend: l.blend, opacity: l.opacity };
  }, 'Add a layer (kind: fill | paint | generator) to the active material.');

  reg('__studioTexPaintLayerList', () => {
    const mat = activeMaterial();
    if (!mat) return { ok: false, count: 0, layers: [] };
    const r = ls.listLayers(mat);
    return { ok: true, count: r.count, layers: r.layers };
  }, 'List the layers on the active material.');

  reg('__studioTexPaintLayerSetEnabled', (uuid, on) => {
    const mat = activeMaterial();
    if (!mat) return { ok: false };
    const ok = ls.setEnabled(mat, uuid, on);
    renderPanel();
    return { ok };
  }, 'Toggle a layer enabled / hidden.');

  reg('__studioTexPaintLayerSetOpacity', (uuid, w) => {
    const mat = activeMaterial();
    if (!mat) return { ok: false };
    const ok = ls.setOpacity(mat, uuid, w);
    renderPanel();
    return { ok };
  }, 'Set a layer\'s opacity (0..1).');

  reg('__studioTexPaintLayerSetBlend', (uuid, blend) => {
    const mat = activeMaterial();
    if (!mat) return { ok: false };
    const ok = ls.setBlend(mat, uuid, blend);
    renderPanel();
    return { ok };
  }, 'Set a layer\'s blend mode (normal | multiply | screen | overlay).');

  reg('__studioTexPaintLayerSetLocked', (uuid, locked) => {
    const mat = activeMaterial();
    if (!mat) return { ok: false };
    const ok = ls.setLocked(mat, uuid, locked);
    renderPanel();
    return { ok };
  }, 'Lock / unlock a layer.');

  reg('__studioTexPaintLayerDelete', (uuid) => {
    const mat = activeMaterial();
    if (!mat) return { ok: false };
    const ok = ls.deleteLayer(mat, uuid);
    renderPanel();
    return { ok };
  }, 'Delete a layer by uuid.');

  reg('__studioTexPaintLayerReorder', (uuidFrom, uuidTo) => {
    const mat = activeMaterial();
    if (!mat) return { ok: false };
    const ok = ls.reorder(mat, uuidFrom, uuidTo);
    renderPanel();
    return { ok };
  }, 'Re-order layers — move `uuidFrom` to `uuidTo`\'s position.');

  // Bake / apply.
  reg('__studioTexPaintBake', () => bakeOp(),
    'Composite the stack and assign as the active material\'s `.map`.');

  // Paint brush.
  reg('__studioTexPaintPaintAt', (uv, brushSize, color, opts) => {
    const mesh = getSelectedMesh();
    if (!mesh) return { ok: false, error: 'no mesh' };
    return _paintAt(mesh, uv, brushSize, color, opts);
  }, 'Paint a soft brush dab at UV (u,v) into the active paint layer.');

  // Smart materials.
  reg('__studioTexPaintApplySmartMaterial', (name) => {
    const mat = activeMaterial();
    if (!mat) return { ok: false, error: 'no material' };
    const r = applySmart(mat, name);
    if (r.ok) {
      // Eager bake so the user instantly sees the new material.
      const baked = bakeOp();
      renderPanel();
      // bake may return a Promise; surface synchronously where we can.
      if (baked && typeof baked.then === 'function') {
        return baked.then((b) => ({ ok: true, layersAdded: r.layersAdded, dataUrl: b && b.dataUrl }));
      }
      return { ok: true, layersAdded: r.layersAdded, dataUrl: baked && baked.dataUrl };
    }
    return r;
  }, 'Apply a smart material recipe (e.g. worn-metal, painted-plastic).');

  reg('__studioTexPaintListSmartMaterials', () => listSmartMaterials(),
    'List the available smart-material recipe names.');

  // Mask generators.
  reg('__studioTexPaintMaskGen', (kind, opts) => {
    const mesh = getSelectedMesh();
    const r = genMask(kind, mesh, opts || {});
    if (!r || !r.dataUrl) return { ok: false, error: 'mask gen failed' };
    return { ok: true, dataUrl: r.dataUrl, kind };
  }, 'Generate a procedural mask (curvature | dirt | edges) → dataUrl.');

  reg('__studioTexPaintListMaskKinds', () => ({ ok: true, kinds: MASK_KINDS.slice() }),
    'List the available mask-generator kinds.');

  // Panel toggles.
  reg('__studioTexPaintPanelOpen',   panelOpen,   'Open the texture-paint side panel.');
  reg('__studioTexPaintPanelClose',  panelClose,  'Close the texture-paint side panel.');
  reg('__studioTexPaintPanelToggle', panelToggle, 'Toggle the texture-paint side panel.');

  // Hotkey: Esc closes the panel (only when open + no input focused).
  const onKey = (e) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.key === 'Escape' && _open) { panelClose(); e.preventDefault(); }
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);

  _installed = true;
  return { ok: true, alreadyInstalled: false };
}

export function uninstallTexPaint() {
  if (typeof window === 'undefined') return { ok: false };
  for (const k of [
    '__studioTexPaintLayerAdd', '__studioTexPaintLayerList',
    '__studioTexPaintLayerSetEnabled', '__studioTexPaintLayerSetOpacity',
    '__studioTexPaintLayerSetBlend', '__studioTexPaintLayerSetLocked',
    '__studioTexPaintLayerDelete', '__studioTexPaintLayerReorder',
    '__studioTexPaintBake', '__studioTexPaintPaintAt',
    '__studioTexPaintApplySmartMaterial', '__studioTexPaintListSmartMaterials',
    '__studioTexPaintMaskGen', '__studioTexPaintListMaskKinds',
    '__studioTexPaintPanelOpen', '__studioTexPaintPanelClose', '__studioTexPaintPanelToggle',
  ]) {
    try { delete window[k]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(k); } catch (_) {}
    }
  }
  if (_root) { try { _root.unmount(); } catch (_) {} _root = null; }
  if (_host && _host.parentNode) _host.parentNode.removeChild(_host);
  _host = null; _open = false;
  window.__studioTexPaintInstalled = false;
  _installed = false;
  return { ok: true };
}
