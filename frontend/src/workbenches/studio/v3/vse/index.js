// ArchDisc Studio V3 — VSE install + window.__studioVSE* API.
//
// installVSE() is idempotent. It:
//   • exposes window.__studioVSE* ops described in the slice brief
//   • mounts the VSEEditor React component into a body-attached host
//     so we don't have to modify StudioShellV3.jsx
//   • auto-registers every op with the V3 command palette under the
//     'vse' category
//
// The editor + ops share a single timeline module-level state — both
// the React UI and the headless op surface mutate the same Map.

import React from 'react';
import {
  listStrips, getStrip, addStrip, removeStrip,
  setStripTime, setStripChannel, setStripParams,
  getTime, setTime, play, pause, isPlaying, setSpeed, getState,
  ensureTick, reset, toJSON, fromJSON,
} from './timeline.js';
import { composeAt, exportSequence, preloadImage } from './compose.js';
import VSEEditor from './VSEEditor.jsx';
import { mountPanel, unmountPanel } from '../common/panel.js';
import { registerOp, unregisterOps } from '../common/registry.js';

let _installed = false;
let _panel = null;
let _editorOpen = false;

// ─── Editor lifecycle ────────────────────────────────────────────────
function mountEditorHost() {
  if (_panel) return _panel.host;
  _panel = mountPanel('vse-editor');
  return _panel ? _panel.host : null;
}

function renderEditor() {
  if (!_panel) return;
  if (!_editorOpen) {
    _panel.render(null);
    return;
  }
  _panel.render(
    React.createElement(VSEEditor, {
      listStrips,
      getState,
      getTime,
      setTime: (t) => { setTime(t); },
      play: () => { play(); renderEditor(); },
      pause: () => { pause(); renderEditor(); },
      isPlaying,
      setSpeed,
      addStrip: (kind, channel, st, en, params) => {
        const s = addStrip(kind, channel, st, en, params);
        // For image strips, kick off a preload so the first paint lands real pixels.
        if (s.kind === 'image' && s.params.dataUrl) preloadImage(s.params.dataUrl);
        return s;
      },
      removeStrip,
      setStripTime,
      setStripChannel,
      setStripParams,
      composeAt,
      exportSequence,
      onCloseRequest: () => editorClose(),
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

// ─── Op registration (delegates to common/registry.js) ───────────────
function reg(name, fn, description) {
  registerOp(name, fn, 'vse', description);
}

// ─── Install ────────────────────────────────────────────────────────
export function installVSE() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  // CRUD ─────────────────────────────────────────────────────────
  reg('__studioVSEAddStrip', (kind, channel, startTime, endTime, params) => {
    try {
      const s = addStrip(kind, channel, startTime, endTime, params);
      if (s.kind === 'image' && s.params.dataUrl) preloadImage(s.params.dataUrl);
      if (_editorOpen) renderEditor();
      return { ok: true, uuid: s.uuid, kind: s.kind, channel: s.channel,
        startTime: s.startTime, endTime: s.endTime };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }, 'Add a VSE strip (kind: image|viewport|colorcorrect).');

  reg('__studioVSEListStrips', () => ({
    ok: true,
    count: listStrips().length,
    strips: listStrips().map((s) => ({
      uuid: s.uuid, kind: s.kind, channel: s.channel,
      startTime: s.startTime, endTime: s.endTime,
      params: { ...s.params },
    })),
  }), 'List every VSE strip.');

  reg('__studioVSEGetStrip', (uuid) => {
    const s = getStrip(uuid);
    if (!s) return { ok: false, error: 'not found' };
    return {
      ok: true, uuid: s.uuid, kind: s.kind, channel: s.channel,
      startTime: s.startTime, endTime: s.endTime, params: { ...s.params },
    };
  }, 'Read a single VSE strip.');

  reg('__studioVSESetStripTime', (uuid, start, end) => {
    const ok = setStripTime(uuid, start, end);
    if (_editorOpen) renderEditor();
    return { ok };
  }, 'Move a strip\'s start/end times.');

  reg('__studioVSESetStripChannel', (uuid, channel) => {
    const ok = setStripChannel(uuid, channel);
    if (_editorOpen) renderEditor();
    return { ok };
  }, 'Move a strip to a different channel (1 = lowest).');

  reg('__studioVSESetStripParams', (uuid, params) => {
    const ok = setStripParams(uuid, params);
    const s = getStrip(uuid);
    if (s && s.kind === 'image' && s.params.dataUrl) preloadImage(s.params.dataUrl);
    if (_editorOpen) renderEditor();
    return { ok };
  }, 'Patch a strip\'s params (e.g. dataUrl, gain, gamma…).');

  reg('__studioVSERemoveStrip', (uuid) => {
    const ok = removeStrip(uuid);
    if (_editorOpen) renderEditor();
    return { ok };
  }, 'Delete a strip.');

  // Scrub / compose ──────────────────────────────────────────────
  reg('__studioVSEScrub', (t) => {
    const n = Number(t);
    if (!Number.isFinite(n)) return { ok: false, error: 'bad time' };
    setTime(n);
    const r = composeAt(n);
    if (_editorOpen) renderEditor();
    return {
      ok: !!r.ok, dataUrl: r.dataUrl,
      width: r.width, height: r.height,
      painted: r.painted, activeCount: r.activeCount,
    };
  }, 'Set the playhead to time t and return the composed frame.');

  reg('__studioVSECompose', (t, opts) => {
    const r = composeAt(Number.isFinite(+t) ? +t : getTime(), opts || {});
    return {
      ok: !!r.ok, dataUrl: r.dataUrl,
      width: r.width, height: r.height,
      painted: r.painted, activeCount: r.activeCount,
    };
  }, 'Compose the timeline at a specific time without moving the playhead.');

  // Transport ────────────────────────────────────────────────────
  reg('__studioVSEPlay', () => {
    play();
    if (_editorOpen) renderEditor();
    return { ok: true, playing: true };
  }, 'Start the VSE transport.');

  reg('__studioVSEPause', () => {
    pause();
    if (_editorOpen) renderEditor();
    return { ok: true, playing: false };
  }, 'Pause the VSE transport.');

  reg('__studioVSESetSpeed', (s) => {
    const v = setSpeed(s);
    if (_editorOpen) renderEditor();
    return { ok: true, speed: v };
  }, 'Set transport speed multiplier (>0).');

  reg('__studioVSEGetState', () => ({ ok: true, ...getState() }),
    'Read time / playing / speed / duration / strip count.');

  reg('__studioVSEReset', () => {
    reset();
    if (_editorOpen) renderEditor();
    return { ok: true };
  }, 'Wipe every strip + reset transport.');

  // Persistence ──────────────────────────────────────────────────
  reg('__studioVSESerialize', () => ({ ok: true, json: toJSON() }),
    'Serialise the VSE timeline to plain JSON.');

  reg('__studioVSEDeserialize', (json) => {
    fromJSON(json);
    if (_editorOpen) renderEditor();
    return { ok: true, count: listStrips().length };
  }, 'Replace the VSE timeline from JSON.');

  // Export sequence ─────────────────────────────────────────────
  reg('__studioVSEExportSequence', (fps, durationSec, opts) => {
    const r = exportSequence(fps, durationSec, opts || {});
    return r;
  }, 'Render N evenly-spaced PNG dataURLs covering [0, durationSec].');

  // Editor toggles ──────────────────────────────────────────────
  reg('__studioVSEEditorOpen', editorOpen, 'Open the VSE editor panel.');
  reg('__studioVSEEditorClose', editorClose, 'Close the VSE editor panel.');
  reg('__studioVSEEditorToggle', editorToggle, 'Toggle the VSE editor panel.');

  // Esc to close.
  const _onKey = (e) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.key === 'Escape' && _editorOpen) { editorClose(); e.preventDefault(); }
  };
  window.addEventListener('keydown', _onKey);

  // Start the transport tick even if the user hasn't hit Play yet — the
  // editor's render loop reads getState() and needs the duration value
  // current. ensureTick() is idempotent.
  ensureTick();

  return { ok: true, alreadyInstalled: false };
}

export function uninstallVSE() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  unregisterOps([
    '__studioVSEAddStrip', '__studioVSEListStrips', '__studioVSEGetStrip',
    '__studioVSESetStripTime', '__studioVSESetStripChannel', '__studioVSESetStripParams',
    '__studioVSERemoveStrip',
    '__studioVSEScrub', '__studioVSECompose',
    '__studioVSEPlay', '__studioVSEPause', '__studioVSESetSpeed',
    '__studioVSEGetState', '__studioVSEReset',
    '__studioVSESerialize', '__studioVSEDeserialize',
    '__studioVSEExportSequence',
    '__studioVSEEditorOpen', '__studioVSEEditorClose', '__studioVSEEditorToggle',
  ]);
  if (_panel) { unmountPanel('vse-editor'); _panel = null; }
  _editorOpen = false;
  _installed = false;
  return { ok: true };
}
