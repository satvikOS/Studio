// ArchDisc Studio V3 — audio system installer.
//
// installAudio() exposes the __studioAudio* op family, registers each
// op under the 'audio' category, mounts the AudioPanel into a
// body-attached host (so we never touch StudioShellV3.jsx), and wraps
// __studioPlayAnimation / __studioPauseAnimation so audio stays
// glued to the existing animation transport.
//
// Coexists with audioxrops.js — that module owns the spatial-audio /
// XR family (__studioAddAudioSource, __studioSetListener,
// __studioAudioState, __studioXRSupport, __studioEnterXR) under a
// different prefix shape, so there's no name collision with our
// __studioAudioLoad / __studioAudioPlay / etc.

import React from 'react';
import {
  loadAudio, generateSineWave, unloadAudio, getEntry, listEntries,
  getAll as getBufferStore,
} from './load.js';
import {
  play, pause, stop, setVolume, getVolume, getCurrentTime,
  isPlaying, destroyState, listPlaybackStates, installAnimSync,
} from './playback.js';
import { renderWaveform, envelopeFor } from './waveform.js';
import AudioPanel from './AudioPanel.jsx';
import { mountPanel, unmountPanel } from '../common/panel.js';
import { registerOp, unregisterOps } from '../common/registry.js';

let _installed = false;
let _panel = null;
let _panelOpen = false;

// ─── Panel lifecycle ─────────────────────────────────────────────────
function mountPanelHost() {
  if (_panel) return _panel.host;
  _panel = mountPanel('audio-panel');
  return _panel ? _panel.host : null;
}

function renderPanel() {
  if (!_panel) return;
  if (!_panelOpen) { _panel.render(null); return; }
  _panel.render(
    React.createElement(AudioPanel, {
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

// ─── Op registration helper (delegates to common/registry.js) ────────
function reg(name, fn, description) {
  registerOp(name, fn, 'audio', description);
}

// ─── Install ─────────────────────────────────────────────────────────
export function installAudio() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  // Load + decode an audio file (or a generated buffer).
  reg('__studioAudioLoad', async (input, opts) => {
    const r = await loadAudio(input, opts || {});
    if (r && r.ok && _panelOpen) renderPanel();
    return r;
  }, 'Decode an audio ArrayBuffer / data URL into an AudioBuffer.');

  reg('__studioAudioGenerateSineWave', (freqHz, durSec, opts) => {
    const r = generateSineWave(freqHz, durSec, opts || {});
    if (r && r.ok && _panelOpen) renderPanel();
    return r;
  }, 'Synthesise a pure sine tone clip (for tests + the intro chime).');

  reg('__studioAudioRenderWaveform', (uuid, w, h, opts) =>
    renderWaveform(uuid, w, h, opts || {}),
    'Render the min/max-envelope waveform for a clip; returns a PNG data URL.');

  reg('__studioAudioEnvelope', (uuid, w) =>
    envelopeFor(uuid, w),
    'Headless helper — returns the min/max envelope arrays.');

  reg('__studioAudioPlay', (uuid, atTime) => {
    const r = play(uuid, atTime);
    if (_panelOpen) renderPanel();
    return r;
  }, 'Start playback of a loaded clip (atTime defaults to 0 or paused-at).');

  reg('__studioAudioPause', (uuid) => {
    const r = pause(uuid);
    if (_panelOpen) renderPanel();
    return r;
  }, 'Pause a playing clip.');

  reg('__studioAudioStop', (uuid) => {
    const r = stop(uuid);
    if (_panelOpen) renderPanel();
    return r;
  }, 'Stop a clip and reset its play head to 0.');

  reg('__studioAudioSetVolume', (uuid, v) => setVolume(uuid, v),
    'Set a clip\'s gain (0..1).');

  reg('__studioAudioGetVolume', (uuid) => ({ ok: true, volume: getVolume(uuid) }),
    'Read a clip\'s current gain.');

  reg('__studioAudioGetCurrentTime', (uuid) =>
    ({ ok: true, time: getCurrentTime(uuid) }),
    'Read the play head position (seconds) of a clip.');

  reg('__studioAudioIsPlaying', (uuid) =>
    ({ ok: true, playing: isPlaying(uuid) }),
    'Report whether a clip is currently playing.');

  reg('__studioAudioList', () => {
    const entries = listEntries();
    const states = listPlaybackStates();
    const byUuid = new Map();
    states.forEach((s) => byUuid.set(s.uuid, s));
    return {
      ok: true,
      count: entries.length,
      clips: entries.map((e) => {
        const s = byUuid.get(e.uuid);
        return {
          uuid: e.uuid,
          name: e.name,
          duration: e.duration,
          sampleRate: e.sampleRate,
          channels: e.channels,
          playing: s ? s.playing : false,
          time: s ? s.currentTime : 0,
          volume: s ? s.volume : 1,
        };
      }),
    };
  }, 'List every loaded audio clip with its current transport state.');

  reg('__studioAudioGetState', (uuid) => {
    const e = getEntry(uuid);
    if (!e) return { ok: false, error: 'unknown audio uuid' };
    return {
      ok: true,
      uuid,
      name: e.name,
      duration: e.buffer ? e.buffer.duration : 0,
      sampleRate: e.buffer ? e.buffer.sampleRate : 0,
      channels: e.buffer ? e.buffer.numberOfChannels : 0,
      playing: isPlaying(uuid),
      time: getCurrentTime(uuid),
      volume: getVolume(uuid),
    };
  }, 'Read everything we know about a clip.');

  reg('__studioAudioDelete', (uuid) => {
    stop(uuid);
    destroyState(uuid);
    const had = unloadAudio(uuid);
    if (_panelOpen) renderPanel();
    return { ok: true, removed: had };
  }, 'Stop + dispose a clip (frees the AudioBuffer + transport state).');

  reg('__studioAudioClear', () => {
    let n = 0;
    getBufferStore().forEach((_, uuid) => {
      stop(uuid);
      destroyState(uuid);
      if (unloadAudio(uuid)) n += 1;
    });
    if (_panelOpen) renderPanel();
    return { ok: true, removed: n };
  }, 'Wipe every loaded clip and stop all transports.');

  reg('__studioAudioPanelOpen', panelOpen,
    'Open the floating audio panel.');
  reg('__studioAudioPanelClose', panelClose,
    'Close the floating audio panel.');
  reg('__studioAudioPanelToggle', panelToggle,
    'Toggle the floating audio panel.');

  // Glue audio to the animation transport. Best-effort — if api.js is
  // still booting, the wrap will be a no-op for now; we re-try on each
  // play() call below so a late install still catches.
  installAnimSync();

  // Re-attempt sync wrap on the next microtask in case api.js wires
  // __studioPlayAnimation after us (load order isn't deterministic).
  Promise.resolve().then(() => installAnimSync());

  // Esc-to-close while the panel is open.
  const _onKey = (e) => {
    if (!_panelOpen) return;
    const ae = (typeof document !== 'undefined') ? document.activeElement : null;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.key === 'Escape') { panelClose(); e.preventDefault(); }
  };
  window.addEventListener('keydown', _onKey);

  return { ok: true, alreadyInstalled: false };
}

export function uninstallAudio() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  unregisterOps([
    '__studioAudioLoad', '__studioAudioGenerateSineWave',
    '__studioAudioRenderWaveform', '__studioAudioEnvelope',
    '__studioAudioPlay', '__studioAudioPause', '__studioAudioStop',
    '__studioAudioSetVolume', '__studioAudioGetVolume',
    '__studioAudioGetCurrentTime', '__studioAudioIsPlaying',
    '__studioAudioList', '__studioAudioGetState',
    '__studioAudioDelete', '__studioAudioClear',
    '__studioAudioPanelOpen', '__studioAudioPanelClose', '__studioAudioPanelToggle',
  ]);
  if (_panel) { unmountPanel('audio-panel'); _panel = null; }
  _panelOpen = false;
  _installed = false;
  return { ok: true };
}
