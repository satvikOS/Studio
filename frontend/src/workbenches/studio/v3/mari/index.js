// ArchDisc Studio V3 — Mari installer + window.__studioMari* surface.
//
// `installMari()` wires every op surface, mounts the React panel into a
// body-attached host (so StudioShellV3.jsx stays untouched), and
// registers every op with the V3 command palette under category
// 'texpaint' (Mari is the second 'texpaint'-category module alongside
// the layer-stack and projection paint slices).
//
// Idempotent — guarded by `window.__studioMariInstalled`.

import React from 'react';
import {
  getUDIMTile, listUDIMs, setUDIMTexture, getUDIMTexture,
  exportUDIMDataUrl, clearUDIM,
} from './udim.js';
import {
  CHANNELS, CHANNEL_NAMES,
  isChannelEnabled, setChannelEnabled, enabledChannels,
  getChannelColor, setChannelColor,
  setChannelAt, getChannelTextureDataUrl, listChannels,
  compositeChannelStack, applyToMaterial,
} from './channels.js';
import {
  paintMultiChannel, paintMultiChannelStroke, activeStampChannels,
} from './multipaint.js';
import MariPanel from './MariPanel.jsx';
import { mountPanel, unmountPanel } from '../common/panel.js';
import { registerOp, unregisterOps } from '../common/registry.js';

let _installed = false;
let _panel = null;
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
  if (_panel) return _panel.host;
  _panel = mountPanel('mari');
  return _panel ? _panel.host : null;
}

function _renderPanel() {
  if (!_panel) return;
  if (!_open) { _panel.render(null); return; }
  _panel.render(
    React.createElement(MariPanel, {
      getSelectedMesh: _getSelectedMesh,
      listChannels: () => {
        const m = _getSelectedMesh();
        return listChannels(m);
      },
      listUDIMs: () => {
        const m = _getSelectedMesh();
        return listUDIMs(m);
      },
      getChannelTextureDataUrl: (channel, udim) => {
        const m = _getSelectedMesh();
        if (!m) return null;
        return getChannelTextureDataUrl(m, channel, udim);
      },
      onSetChannelEnabled: (name, on) => {
        setChannelEnabled(name, on);
        _renderPanel();
      },
      onSetChannelColor: (name, color) => {
        setChannelColor(name, color);
        _renderPanel();
      },
      onCompositeAndApply: () => {
        const m = _getSelectedMesh();
        if (!m) return;
        applyToMaterial(m);
        _renderPanel();
      },
      onClearTile: (udim) => {
        const m = _getSelectedMesh();
        if (!m) return;
        clearUDIM(m, udim);
        _renderPanel();
      },
      onPaintSampleStroke: () => {
        const m = _getSelectedMesh();
        if (!m) return;
        // Walk a short diagonal in UV space — gives every UDIM-bound
        // channel a visible smear without forcing the user to drag.
        const uvs = [];
        for (let i = 0; i < 12; i++) {
          const t = i / 11;
          uvs.push([0.2 + t * 0.6, 0.3 + t * 0.4]);
        }
        paintMultiChannelStroke(m, uvs, { size: 22, hardness: 0.45, opacity: 0.85 });
        _renderPanel();
      },
      onCloseRequest: panelClose,
    })
  );
}

function panelOpen()   { _mountHost(); _open = true;  _renderPanel(); return { ok: true, open: true }; }
function panelClose()  { _open = false; _renderPanel(); return { ok: true, open: false }; }
function panelToggle() { return _open ? panelClose() : panelOpen(); }

function _reg(name, fn, description) {
  registerOp(name, fn, 'texpaint', description);
}

export function installMari() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (window.__studioMariInstalled) return { ok: true, alreadyInstalled: true };
  window.__studioMariInstalled = true;

  // ── UDIM addressing ──────────────────────────────────────────────────
  _reg('__studioMariGetUDIM', (meshUuid, u, v) => {
    const m = _meshByUuid(meshUuid);
    if (!m) return { ok: false, error: 'no mesh' };
    return getUDIMTile(Number(u), Number(v));
  }, 'Compute the UDIM tile index (1001 + tileX + tileY*10) for a UV.');

  _reg('__studioMariListUDIMs', (meshUuid) => {
    const m = _meshByUuid(meshUuid);
    if (!m) return { ok: false, error: 'no mesh' };
    return listUDIMs(m);
  }, 'List every UDIM tile currently allocated on a mesh.');

  _reg('__studioMariSetUDIMTexture', (meshUuid, udim, dataUrl) => {
    const m = _meshByUuid(meshUuid);
    if (!m) return { ok: false, error: 'no mesh' };
    const r = setUDIMTexture(m, Number(udim), dataUrl);
    _renderPanel();
    return { ok: r.ok, udim: r.udim };
  }, 'Store a CanvasTexture for a UDIM tile on a mesh (legacy single-tex map).');

  _reg('__studioMariGetUDIMTexture', (meshUuid, udim) => {
    const m = _meshByUuid(meshUuid);
    if (!m) return { ok: false, error: 'no mesh' };
    const tex = getUDIMTexture(m, Number(udim));
    return { ok: !!tex, hasTex: !!tex };
  }, 'Read whether a UDIM tile texture exists on a mesh.');

  _reg('__studioMariExportUDIM', (meshUuid, udim) => {
    const m = _meshByUuid(meshUuid);
    if (!m) return { ok: false, error: 'no mesh' };
    const url = exportUDIMDataUrl(m, Number(udim));
    return url ? { ok: true, dataUrl: url } : { ok: false, error: 'no tile' };
  }, 'Export a UDIM tile as a PNG data URL.');

  _reg('__studioMariClearUDIM', (meshUuid, udim) => {
    const m = _meshByUuid(meshUuid);
    if (!m) return { ok: false, error: 'no mesh' };
    const ok = clearUDIM(m, Number(udim));
    _renderPanel();
    return { ok };
  }, 'Drop a single UDIM tile from a mesh.');

  // ── Channel control ─────────────────────────────────────────────────
  _reg('__studioMariListChannels', (meshUuid) => {
    const m = meshUuid ? _meshByUuid(meshUuid) : _getSelectedMesh();
    return { ok: true, channels: listChannels(m) };
  }, 'List the Mari PBR channels with arm / colour / tile-count state.');

  _reg('__studioMariSetChannelEnabled', (channel, on) => {
    const ok = setChannelEnabled(channel, on);
    _renderPanel();
    return { ok, channel, enabled: isChannelEnabled(channel) };
  }, 'Arm or disarm a channel (diffuse/roughness/metallic/normal/height/emissive).');

  _reg('__studioMariSetChannelColor', (channel, color) => {
    const ok = setChannelColor(channel, color);
    _renderPanel();
    return { ok, channel, color: getChannelColor(channel) };
  }, 'Set the brush colour for a channel.');

  _reg('__studioMariEnabledChannels', () => ({ ok: true, channels: enabledChannels() }),
    'Report the channels armed for the next brush stroke.');

  _reg('__studioMariActiveStampChannels', () => ({ ok: true, channels: activeStampChannels() }),
    'Alias for EnabledChannels — for parity with the multipaint helper.');

  _reg('__studioMariSetChannelTexture', (meshUuid, channel, udim, dataUrl) => {
    const m = _meshByUuid(meshUuid);
    if (!m) return { ok: false, error: 'no mesh' };
    const r = setChannelAt(m, channel, Number(udim), dataUrl);
    _renderPanel();
    return r;
  }, 'Replace a channel\'s UDIM tile canvas with a baked image.');

  _reg('__studioMariGetChannelTexture', (meshUuid, channel, udim) => {
    const m = _meshByUuid(meshUuid);
    if (!m) return { ok: false, error: 'no mesh' };
    const url = getChannelTextureDataUrl(m, channel, Number(udim));
    return url ? { ok: true, dataUrl: url } : { ok: false, error: 'no tile' };
  }, 'Read a channel\'s UDIM tile canvas as a PNG data URL.');

  _reg('__studioMariCompositeChannel', (meshUuid, channel, udim) => {
    const m = _meshByUuid(meshUuid);
    if (!m) return { ok: false, error: 'no mesh' };
    const tex = compositeChannelStack(m, channel, Number(udim));
    return { ok: !!tex };
  }, 'Composite the channel stack for one UDIM tile and return whether a texture was produced.');

  // ── Multi-channel painting ──────────────────────────────────────────
  _reg('__studioMariPaintMultiChannel', (meshUuid, uv, brushOpts) => {
    const m = _meshByUuid(meshUuid);
    if (!m) return { ok: false, error: 'no mesh' };
    return paintMultiChannel(m, uv, brushOpts || {});
  }, 'Stamp a brush dab into every armed channel\'s UDIM tile at UV (u,v).');

  _reg('__studioMariPaintMultiChannelStroke', (meshUuid, uvs, brushOpts) => {
    const m = _meshByUuid(meshUuid);
    if (!m) return { ok: false, error: 'no mesh' };
    return paintMultiChannelStroke(m, uvs, brushOpts || {});
  }, 'Run paintMultiChannel for each UV in a list — one bulk multi-channel stroke.');

  _reg('__studioMariCompositeAndApply', (meshUuid) => {
    const m = _meshByUuid(meshUuid);
    if (!m) return { ok: false, error: 'no mesh' };
    const r = applyToMaterial(m);
    _renderPanel();
    return r;
  }, 'Composite every channel\'s active UDIM tile into mat.{map, roughnessMap, ...}.');

  // ── Panel toggles ───────────────────────────────────────────────────
  _reg('__studioMariPanelOpen',   panelOpen,   'Open the Mari side panel.');
  _reg('__studioMariPanelClose',  panelClose,  'Close the Mari side panel.');
  _reg('__studioMariPanelToggle', panelToggle, 'Toggle the Mari side panel.');

  // Esc closes the panel (only when nothing's focused).
  const onKey = (e) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.key === 'Escape' && _open) { panelClose(); e.preventDefault(); }
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);

  _installed = true;
  return { ok: true, alreadyInstalled: false, channels: CHANNEL_NAMES };
}

export function uninstallMari() {
  if (typeof window === 'undefined') return { ok: false };
  unregisterOps([
    '__studioMariGetUDIM', '__studioMariListUDIMs',
    '__studioMariSetUDIMTexture', '__studioMariGetUDIMTexture',
    '__studioMariExportUDIM', '__studioMariClearUDIM',
    '__studioMariListChannels', '__studioMariSetChannelEnabled',
    '__studioMariSetChannelColor', '__studioMariEnabledChannels',
    '__studioMariActiveStampChannels',
    '__studioMariSetChannelTexture', '__studioMariGetChannelTexture',
    '__studioMariCompositeChannel',
    '__studioMariPaintMultiChannel', '__studioMariPaintMultiChannelStroke',
    '__studioMariCompositeAndApply',
    '__studioMariPanelOpen', '__studioMariPanelClose', '__studioMariPanelToggle',
  ]);
  if (_panel) { unmountPanel('mari'); _panel = null; }
  _open = false;
  window.__studioMariInstalled = false;
  _installed = false;
  return { ok: true };
}

export default installMari;

// Internal export used by tests + the CHANNELS table.
export { CHANNELS };
