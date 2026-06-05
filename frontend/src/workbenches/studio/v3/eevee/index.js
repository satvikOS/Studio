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
import { createRoot } from 'react-dom/client';

import EeveePanel from './EeveePanel.jsx';
import {
  enableSSGI, disableSSGI,
  enableSSR,  disableSSR,
  setIntensity, setSSRMaxDistance,
  getState, resetDefaults, teardown,
} from './renderer.js';

let _installed = false;
let _host = null;
let _root = null;
let _open = false;

// ── Panel lifecycle ──────────────────────────────────────────────────────
function _mountHost() {
  if (typeof document === 'undefined') return null;
  if (_host) return _host;
  _host = document.createElement('div');
  _host.setAttribute('data-studio-v3-eevee-host', '');
  document.body.appendChild(_host);
  _root = createRoot(_host);
  return _host;
}

function _renderPanel() {
  if (!_root) return;
  if (!_open) { _root.render(null); return; }
  _root.render(
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
// Mirrors the retry pattern used in rtgpu/index.js + snap2/index.js: if
// __studioCommandRegister isn't ready yet (autoload may run before
// registerV3Api), poll every 100ms for ~5s.
function _reg(name, fn, description) {
  if (typeof window === 'undefined') return;
  window[name] = fn;
  const tryReg = () => {
    if (typeof window.__studioCommandRegister !== 'function') return false;
    try {
      window.__studioCommandRegister(name, fn, { category: 'rt', description });
      return true;
    } catch (_) { return false; }
  };
  if (!tryReg()) {
    let tries = 0;
    const id = setInterval(() => {
      tries++;
      if (tryReg() || tries > 50) clearInterval(id);
    }, 100);
  }
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
  for (const n of OP_NAMES) {
    try { delete window[n]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(n); } catch (_) {}
    }
  }
  if (_root) { try { _root.unmount(); } catch (_) {} _root = null; }
  if (_host && _host.parentNode) _host.parentNode.removeChild(_host);
  _host = null;
  _open = false;
  _installed = false;
  return { ok: true };
}

export default installEevee;
