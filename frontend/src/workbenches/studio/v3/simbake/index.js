// ArchDisc Studio V3 — sim-bake installer.
//
// `installSimBake()` wires:
//   • window.__studioSimBake* op surface
//   • command-palette registration under category 'sim'
//   • a body-attached React panel (no shell edits)
//   • Esc closes the panel when no input is focused
//
// Idempotent — guarded by `window.__studioSimBakeInstalled`.

import React from 'react';

import { bakeSim, listBakeableSources, detectKind } from './bake.js';
import {
  scrubToFrame, playCached, pauseCached, stopCached, stopAll,
  listChannels, getChannelFrame,
} from './playback.js';
import {
  getCached, hasCached, listCached, clearCache, getCacheBytes, size,
} from './store.js';
import BakePanel from './BakePanel.jsx';
import { mountPanel, unmountPanel } from '../common/panel.js';
import { registerOp, unregisterOps } from '../common/registry.js';

let _panel = null;
let _open = false;

// ─── panel mount ───────────────────────────────────────────────────────────
function mountHost() {
  if (_panel) return _panel.host;
  _panel = mountPanel('simbake');
  return _panel ? _panel.host : null;
}

function renderPanel() {
  if (!_panel) return;
  if (!_open) { _panel.render(null); return; }
  _panel.render(
    React.createElement(BakePanel, {
      listSources: () => listBakeableSources(),
      listBakes:   () => listCached(),
      cacheBytes:  () => getCacheBytes(),
      onBake: (uuid, durationSec, fps) => {
        const r = bakeSim(uuid, durationSec, fps);
        renderPanel();
        return r;
      },
      onScrub: (uuid, frame) => {
        const r = scrubToFrame(uuid, frame);
        return r;
      },
      onPlay: (uuid) => {
        const r = playCached(uuid);
        renderPanel();
        return r;
      },
      onPause: (uuid) => {
        const r = pauseCached(uuid);
        renderPanel();
        return r;
      },
      onStop: (uuid) => {
        const r = stopCached(uuid);
        renderPanel();
        return r;
      },
      onClearCache: (uuid) => {
        // Stop playback first so we don't leave a dangling tick.
        try { stopCached(uuid); } catch (_) {}
        const r = clearCache(uuid);
        renderPanel();
        return r;
      },
      onClearAll: () => {
        try { stopAll(); } catch (_) {}
        const r = clearCache(null);
        renderPanel();
        return r;
      },
      getChannelFrame: (uuid) => getChannelFrame(uuid),
      onCloseRequest: panelClose,
    }),
  );
}

function panelOpen()   { mountHost(); _open = true;  renderPanel(); return { ok: true, open: true }; }
function panelClose()  { _open = false; renderPanel(); return { ok: true, open: false }; }
function panelToggle() { return _open ? panelClose() : panelOpen(); }

// ─── command palette registration helper (delegates to common/) ──────
function reg(name, fn, description) {
  registerOp(name, fn, 'sim', description);
}

// ─── public installer ─────────────────────────────────────────────────────
export function installSimBake() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (window.__studioSimBakeInstalled) return { ok: true, alreadyInstalled: true };
  window.__studioSimBakeInstalled = true;

  // Bake & listing.
  reg('__studioSimBakeSource', (uuid, durationSec, fps) => {
    const r = bakeSim(uuid, durationSec, fps);
    if (_open) renderPanel();
    return r;
  }, 'Bake the named sim source for N seconds at FPS, caching per-frame vertex snapshots.');

  reg('__studioSimBakeListSources', () => ({
    ok: true,
    sources: listBakeableSources(),
  }), 'List every bakeable sim source currently in the scene (particles / cloth / soft / fluid / hair).');

  reg('__studioSimBakeListBakes', () => {
    const bakes = listCached();
    return { ok: true, count: bakes.length, bakes };
  }, 'List every cached sim bake by uuid + frames + fps + bytes.');

  reg('__studioSimBakeDetect', (uuid) => {
    const scene = (typeof window !== 'undefined') ? window.__archdiscScene : null;
    const obj = scene ? scene.getObjectByProperty('uuid', uuid) : null;
    return { ok: true, kind: detectKind(obj) };
  }, 'Detect the sim kind of a scene object (particles / cloth / softbody / fluid / hair).');

  // Scrub + playback.
  reg('__studioSimBakeScrubTo', (uuid, frameIdx) => {
    const r = scrubToFrame(uuid, frameIdx);
    return r;
  }, 'Apply the F-th cached frame to the source object\'s vertex buffer.');

  reg('__studioSimBakePlayCached', (uuid, fps) => {
    const r = playCached(uuid, fps);
    if (_open) renderPanel();
    return r;
  }, 'Auto-step the cached bake through __studioAnimTick at the bake\'s fps (or override).');

  reg('__studioSimBakePauseCached', (uuid) => {
    const r = pauseCached(uuid);
    if (_open) renderPanel();
    return r;
  }, 'Pause the cached bake playback without removing the tick link.');

  reg('__studioSimBakeStopCached', (uuid) => {
    const r = stopCached(uuid);
    if (_open) renderPanel();
    return r;
  }, 'Stop the cached bake playback and splice its tick out of __studioAnimTick.');

  reg('__studioSimBakeChannelList', () => ({
    ok: true,
    channels: listChannels(),
  }), 'List every active sim-bake playback channel.');

  reg('__studioSimBakeChannelFrame', (uuid) => ({
    ok: true,
    frame: getChannelFrame(uuid),
  }), 'Report the playback channel\'s current frame index for a uuid.');

  // Cache management.
  reg('__studioSimBakeClearCache', (uuid) => {
    if (uuid != null) {
      try { stopCached(uuid); } catch (_) {}
    } else {
      try { stopAll(); } catch (_) {}
    }
    const r = clearCache(uuid != null ? uuid : null);
    if (_open) renderPanel();
    return r;
  }, 'Clear one cached bake by uuid, or all bakes if uuid is null/undefined.');

  reg('__studioSimBakeGetCacheBytes', () => ({
    ok: true,
    ...getCacheBytes(),
  }), 'Report total bytes held by the bake cache + a per-bake breakdown.');

  reg('__studioSimBakeHasCached', (uuid) => ({
    ok: true,
    cached: hasCached(uuid),
  }), 'Return whether a uuid has a cached bake.');

  reg('__studioSimBakeGetCached', (uuid) => {
    const e = getCached(uuid);
    if (!e) return { ok: false, error: 'no cached bake' };
    return {
      ok: true,
      uuid: e.uuid,
      kind: e.kind,
      name: e.name,
      fps: e.fps,
      frames: e.frames,
      durationSec: e.durationSec,
      vertCount: e.vertCount,
      bytes: e.bytes,
      bakedAt: e.bakedAt,
    };
  }, 'Fetch cached bake metadata for a uuid (without the float buffer).');

  reg('__studioSimBakeCount', () => ({
    ok: true,
    count: size(),
  }), 'Return the total number of cached sim bakes.');

  // Panel toggles.
  reg('__studioSimBakePanelOpen',   panelOpen,   'Open the sim-bake panel.');
  reg('__studioSimBakePanelClose',  panelClose,  'Close the sim-bake panel.');
  reg('__studioSimBakePanelToggle', panelToggle, 'Toggle the sim-bake panel.');

  // Esc closes the panel when no input is focused — mirrors modstack.
  const onKey = (e) => {
    if (typeof document === 'undefined') return;
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.key === 'Escape' && _open) { panelClose(); e.preventDefault(); }
  };
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);

  return { ok: true, alreadyInstalled: false };
}

export function uninstallSimBake() {
  if (typeof window === 'undefined') return { ok: false };
  // Stop every playback channel so we don't leak ticks.
  try { stopAll(); } catch (_) {}
  unregisterOps([
    '__studioSimBakeSource',          '__studioSimBakeListSources',
    '__studioSimBakeListBakes',       '__studioSimBakeDetect',
    '__studioSimBakeScrubTo',         '__studioSimBakePlayCached',
    '__studioSimBakePauseCached',     '__studioSimBakeStopCached',
    '__studioSimBakeChannelList',     '__studioSimBakeChannelFrame',
    '__studioSimBakeClearCache',      '__studioSimBakeGetCacheBytes',
    '__studioSimBakeHasCached',       '__studioSimBakeGetCached',
    '__studioSimBakeCount',
    '__studioSimBakePanelOpen',       '__studioSimBakePanelClose',
    '__studioSimBakePanelToggle',
  ]);
  if (_panel) { unmountPanel('simbake'); _panel = null; }
  _open = false;
  window.__studioSimBakeInstalled = false;
  return { ok: true };
}
