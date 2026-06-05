// ArchDisc Studio V3 — EEVEE viewport-pass installer + op surface.
//
// installEevee() (idempotent) does three things:
//
//   1. Mounts the EeveePanel into a body-attached host so we never touch
//      StudioShellV3.jsx.
//   2. Exposes the window.__studioEevee* op surface listed in the slice
//      brief, each backed by the renderer module's enable/disable + state
//      functions.
//   3. Registers every op with window.__studioCommandRegister(..., {
//      category: 'rt' }) so the EEVEE passes appear in the command
//      palette alongside the slice-684 CPU tracer and slice-693 GPU
//      tracer (all real-time rendering tools).
//
// Each toggle op is async because enabling a pass may need to lazy-load
// EffectComposer / RenderPass / OutputPass modules from three's
// jsm/postprocessing tree if no composer exists yet.

import React from 'react';

import EeveePanel from './EeveePanel.jsx';
import {
  enableSSGI, disableSSGI,
  enableSSR,  disableSSR,
  setIntensity, setSSRMaxDistance,
  getState, resetDefaults, teardown,
} from './renderer.js';
import { mountPanel, unmountPanel } from '../common/panel.js';
import { registerOp, unregisterOps } from '../common/registry.js';

let _installed = false;
let _panel = null;
let _open = false;

// ── Panel lifecycle ──────────────────────────────────────────────────────
function _mountHost() {
  if (!_panel) _panel = mountPanel('eevee');
  return _panel;
}

function _renderPanel() {
  if (!_panel) return;
  if (!_open) { _panel.render(null); return; }
  _panel.render(
    React.createElement(EeveePanel, {
      getState,
      toggleSSGI:        async () => { await __studioEeveeToggleSSGI(); _renderPanel(); },
      toggleSSR:         async () => { await __studioEeveeToggleSSR();  _renderPanel(); },
      setIntensity:      (v)      => { __studioEeveeSetSSGIIntensity(v); _renderPanel(); },
      setSSRMaxDistance: (v)      => { __studioEeveeSetSSRMaxDistance(v); _renderPanel(); },
      resetDefaults:     ()       => { __studioEeveeReset(); _renderPanel(); },
      onCloseRequest:    ()       => __studioEeveePanelClose(),
    })
  );
}

function __studioEeveePanelOpen()   { _mountHost(); _open = true;  _renderPanel(); return { ok: true, open: true }; }
function __studioEeveePanelClose()  { _open = false; _renderPanel(); return { ok: true, open: false }; }
function __studioEeveePanelToggle() { return _open ? __studioEeveePanelClose() : __studioEeveePanelOpen(); }

// ── Ops surface ──────────────────────────────────────────────────────────
async function __studioEeveeToggleSSGI() {
  const s = getState();
  const out = s.ssgi ? disableSSGI() : await enableSSGI();
  if (_open) _renderPanel();
  return out;
}

async function __studioEeveeToggleSSR() {
  const s = getState();
  const out = s.ssr ? disableSSR() : await enableSSR();
  if (_open) _renderPanel();
  return out;
}

function __studioEeveeSetSSGIIntensity(v) {
  const r = setIntensity(v);
  if (_open) _renderPanel();
  return r;
}

function __studioEeveeSetSSRMaxDistance(v) {
  const r = setSSRMaxDistance(v);
  if (_open) _renderPanel();
  return r;
}

function __studioEeveeGetState() {
  return getState();
}

function __studioEeveeReset() {
  const r = resetDefaults();
  if (_open) _renderPanel();
  return r;
}

// ── Op registration helper ───────────────────────────────────────────────
// Slice 695: retry-on-cold-start pattern lives in common/registry.js.
function _reg(name, fn, description) {
  registerOp(name, fn, 'rt', description);
}

const OP_NAMES = [
  '__studioEeveeToggleSSGI',
  '__studioEeveeToggleSSR',
  '__studioEeveeSetSSGIIntensity',
  '__studioEeveeSetSSRMaxDistance',
  '__studioEeveeGetState',
  '__studioEeveeReset',
  '__studioEeveePanelOpen',
  '__studioEeveePanelClose',
  '__studioEeveePanelToggle',
];

export function installEevee() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  _reg('__studioEeveeToggleSSGI',        __studioEeveeToggleSSGI,
    'Toggle the EEVEE-style screen-space global illumination pass.');
  _reg('__studioEeveeToggleSSR',         __studioEeveeToggleSSR,
    'Toggle the EEVEE-style screen-space reflections pass.');
  _reg('__studioEeveeSetSSGIIntensity',  __studioEeveeSetSSGIIntensity,
    'Set the SSGI indirect-light intensity multiplier (0..2, default 1).');
  _reg('__studioEeveeSetSSRMaxDistance', __studioEeveeSetSSRMaxDistance,
    'Set the SSR max trace distance in UV units (0.05..2.0, default 0.5).');
  _reg('__studioEeveeGetState',          __studioEeveeGetState,
    'Read EEVEE pass state: { ok, ssgi, ssr, intensity, ssrDistance }.');
  _reg('__studioEeveeReset',             __studioEeveeReset,
    'Reset SSGI intensity + SSR distance to factory defaults.');
  _reg('__studioEeveePanelOpen',         __studioEeveePanelOpen,
    'Open the EEVEE side panel.');
  _reg('__studioEeveePanelClose',        __studioEeveePanelClose,
    'Close the EEVEE side panel.');
  _reg('__studioEeveePanelToggle',       __studioEeveePanelToggle,
    'Toggle the EEVEE side panel.');

  // Esc closes the panel — same UX hook as snap2.
  if (typeof window !== 'undefined') {
    const onKey = (e) => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      if (e.key === 'Escape' && _open) { __studioEeveePanelClose(); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
  }

  return { ok: true, ops: OP_NAMES.length };
}

export function uninstallEevee() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  try { teardown(); } catch (_) {}
  unregisterOps(OP_NAMES);
  unmountPanel('eevee');
  _panel = null;
  _open = false;
  _installed = false;
  return { ok: true };
}

export default installEevee;
