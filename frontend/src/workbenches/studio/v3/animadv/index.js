// ArchDisc Studio V3 — Drivers + NLA installer.
//
// `installAnimAdv()` is idempotent. It:
//   • exposes window.__studioAnimAdv* ops described in the slice brief
//   • mounts the NLAEditor component into a body-attached host so we
//     never touch StudioShellV3.jsx
//   • auto-registers every op with the V3 command palette under the
//     'animadv' category
//   • chains the per-frame driver + NLA evaluation into the existing
//     __studioAnimTick chain (drivers fire first, then NLA — so a
//     driver can produce a base value that an NLA strip layers over)
//
// Coexists with v3/anim/ (bezier graph editor) — we *reuse* its curves
// as the data source for NLA strips. Drivers, by contrast, don't need
// curves at all.

import React from 'react';

import {
  addDriver, deleteDriver, enableDriver, listDrivers,
  clearDrivers, applyAllDrivers,
  installDriverTick, uninstallDriverTick,
} from './drivers.js';
import {
  addStrip, deleteStrip, listStrips, getStrip,
  setStripBlend, setStripTime, setStripScale, setStripEnabled,
  clearStrips, applyAllStrips,
  installNLATick, uninstallNLATick,
} from './nla.js';
import NLAEditor from './NLAEditor.jsx';
import { mountPanel, unmountPanel } from '../common/panel.js';
import { registerOp, unregisterOps } from '../common/registry.js';

let _installed = false;
let _panel = null;
let _editorOpen = false;
let _playing = false;

// ─── Editor lifecycle ────────────────────────────────────────────────
function mountEditorHost() {
  if (_panel) return _panel.host;
  _panel = mountPanel('animadv-nla-editor');
  return _panel ? _panel.host : null;
}

function renderEditor() {
  if (!_panel) return;
  if (!_editorOpen) {
    _panel.render(null);
    return;
  }
  _panel.render(
    React.createElement(NLAEditor, {
      getStrips: () => listStrips(),
      getDrivers: () => listDrivers(),
      onStripUpdate: (uuid, patch) => {
        if (!patch) return;
        if ('blend' in patch) setStripBlend(uuid, patch.blend);
        if ('startTime' in patch || 'endTime' in patch) {
          const s = getStrip(uuid);
          if (s) {
            setStripTime(
              uuid,
              'startTime' in patch ? patch.startTime : s.startTime,
              'endTime' in patch ? patch.endTime : s.endTime,
            );
          }
        }
        if ('scale' in patch) setStripScale(uuid, patch.scale);
        if ('enabled' in patch) setStripEnabled(uuid, patch.enabled);
      },
      onStripDelete: (uuid) => { deleteStrip(uuid); },
      onClose: () => editorClose(),
    })
  );
}

function editorOpen() {
  mountEditorHost();
  _editorOpen = true;
  renderEditor();
  return { ok: true, open: true };
}
function editorClose() {
  _editorOpen = false;
  renderEditor();
  return { ok: true, open: false };
}
function editorToggle() {
  return _editorOpen ? editorClose() : editorOpen();
}

// ─── Op registration helper (delegates to common/registry.js) ────────
function reg(name, fn, description) {
  registerOp(name, fn, 'animadv', description);
}

function getSelectedMesh() {
  if (typeof window === 'undefined') return null;
  if (typeof window.__studioSelectedMesh === 'function') {
    try { return window.__studioSelectedMesh(); } catch (_) {}
  }
  const vp = window.__archdiscViewport;
  if (vp && typeof vp.getSelected === 'function') {
    try { return vp.getSelected(); } catch (_) {}
  }
  return null;
}

// ─── Install ─────────────────────────────────────────────────────────
export function installAnimAdv() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  // ── Driver ops ─────────────────────────────────────────────────────
  reg('__studioAnimAdvDriverAdd', (targetMeshUuid, targetProperty, sourceMeshUuid, sourceProperty, expression) => {
    let tgt = targetMeshUuid;
    if (!tgt) {
      const sel = getSelectedMesh();
      if (!sel) return { ok: false, error: 'no target mesh' };
      tgt = sel.uuid;
    }
    return addDriver({
      targetMeshUuid: tgt,
      targetProperty,
      sourceMeshUuid: sourceMeshUuid || tgt,
      sourceProperty,
      expression,
    });
  }, 'Add a driver: targetProp = f(sourceProp). Expression in {+,-,*,/,sin,cos,clamp,min,max,if}.');

  reg('__studioAnimAdvDriverList', () => {
    const list = listDrivers();
    return { ok: true, count: list.length, drivers: list };
  }, 'List every registered driver.');

  reg('__studioAnimAdvDriverDelete', (uuid) =>
    deleteDriver(uuid),
    'Delete a driver by uuid.');

  reg('__studioAnimAdvDriverEnable', (uuid, on) =>
    enableDriver(uuid, on !== false),
    'Enable / disable a driver without removing it.');

  reg('__studioAnimAdvDriverApplyNow', (time) =>
    ({ ok: true, applied: applyAllDrivers(time) }),
    'Evaluate every driver once and write into targets.');

  reg('__studioAnimAdvDriverClear', () => {
    clearDrivers();
    return { ok: true };
  }, 'Remove every driver.');

  // ── NLA ops ────────────────────────────────────────────────────────
  reg('__studioAnimAdvNLAStripAdd', (targetMeshUuid, property, curveUuid, startTime, endTime, opts) => {
    let tgt = targetMeshUuid;
    if (!tgt) {
      const sel = getSelectedMesh();
      if (!sel) return { ok: false, error: 'no target mesh' };
      tgt = sel.uuid;
    }
    return addStrip(tgt, property, curveUuid, startTime, endTime, opts || {});
  }, 'Add an NLA strip: window of (mesh, property) sourced by curveUuid.');

  reg('__studioAnimAdvNLAStripList', () => {
    const list = listStrips();
    return { ok: true, count: list.length, strips: list };
  }, 'List every NLA strip.');

  reg('__studioAnimAdvNLAStripSetBlend', (uuid, blend) =>
    setStripBlend(uuid, blend),
    'Set a strip\'s blend mode: replace | add | mul.');

  reg('__studioAnimAdvNLAStripSetTime', (uuid, start, end) =>
    setStripTime(uuid, start, end),
    'Move a strip\'s start/end on the timeline.');

  reg('__studioAnimAdvNLAStripSetScale', (uuid, scale) =>
    setStripScale(uuid, scale),
    'Time-warp factor for a strip (1 = authored speed).');

  reg('__studioAnimAdvNLAStripSetEnabled', (uuid, on) =>
    setStripEnabled(uuid, on !== false),
    'Enable / disable a strip without removing it.');

  reg('__studioAnimAdvNLAStripDelete', (uuid) =>
    deleteStrip(uuid),
    'Delete a strip.');

  reg('__studioAnimAdvNLAStripApplyNow', (time) =>
    ({ ok: true, applied: applyAllStrips(time) }),
    'Evaluate the strip stack once and write into targets.');

  reg('__studioAnimAdvNLAStripClear', () => {
    clearStrips();
    return { ok: true };
  }, 'Remove every NLA strip.');

  // ── Editor ─────────────────────────────────────────────────────────
  reg('__studioAnimAdvNLAEditorOpen', editorOpen, 'Open the NLA strip editor.');
  reg('__studioAnimAdvNLAEditorClose', editorClose, 'Close the NLA strip editor.');
  reg('__studioAnimAdvNLAEditorToggle', editorToggle, 'Toggle the NLA strip editor.');

  // ── Transport ──────────────────────────────────────────────────────
  reg('__studioAnimAdvTogglePlay', () => {
    _playing = !_playing;
    if (_playing) {
      installDriverTick();
      installNLATick();
    }
    return { ok: true, playing: _playing };
  }, 'Toggle driver + NLA per-frame evaluation.');

  reg('__studioAnimAdvIsPlaying', () => ({ ok: true, playing: _playing }),
    'Read driver + NLA play state.');

  reg('__studioAnimAdvReset', () => {
    clearDrivers();
    clearStrips();
    _playing = false;
    if (_editorOpen) renderEditor();
    return { ok: true };
  }, 'Wipe every driver + strip.');

  // ── Esc to close editor ────────────────────────────────────────────
  const _onKey = (e) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.key === 'Escape' && _editorOpen) { editorClose(); e.preventDefault(); }
  };
  window.addEventListener('keydown', _onKey);

  // Best-effort install of the tick chain now — viewport may not exist
  // yet at install time; togglePlay also retries.
  installDriverTick();
  installNLATick();

  return { ok: true, alreadyInstalled: false };
}

export function uninstallAnimAdv() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  unregisterOps([
    '__studioAnimAdvDriverAdd', '__studioAnimAdvDriverList',
    '__studioAnimAdvDriverDelete', '__studioAnimAdvDriverEnable',
    '__studioAnimAdvDriverApplyNow', '__studioAnimAdvDriverClear',
    '__studioAnimAdvNLAStripAdd', '__studioAnimAdvNLAStripList',
    '__studioAnimAdvNLAStripSetBlend', '__studioAnimAdvNLAStripSetTime',
    '__studioAnimAdvNLAStripSetScale', '__studioAnimAdvNLAStripSetEnabled',
    '__studioAnimAdvNLAStripDelete', '__studioAnimAdvNLAStripApplyNow',
    '__studioAnimAdvNLAStripClear',
    '__studioAnimAdvNLAEditorOpen', '__studioAnimAdvNLAEditorClose',
    '__studioAnimAdvNLAEditorToggle',
    '__studioAnimAdvTogglePlay', '__studioAnimAdvIsPlaying', '__studioAnimAdvReset',
  ]);
  uninstallDriverTick();
  uninstallNLATick();
  if (_panel) { unmountPanel('animadv-nla-editor'); _panel = null; }
  _editorOpen = false;
  _installed = false;
  return { ok: true };
}
