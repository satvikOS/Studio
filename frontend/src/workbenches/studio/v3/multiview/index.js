// ArchDisc Studio V3 — Quad-view (multiview) installer.
//
// `installMultiView()` is idempotent. It exposes:
//
//   window.__studioMultiViewToggle()        → { ok, on }
//   window.__studioMultiViewEnable()        → { ok, on:true }
//   window.__studioMultiViewDisable()       → { ok, on:false }
//   window.__studioMultiViewMaximizePane(i) → { ok, maximized }
//   window.__studioMultiViewSetSplit(h, v)  → { ok, hRatio, vRatio }
//   window.__studioMultiViewGetState()      → { on, ratios, panes, maximized }
//
// Every op auto-registers under the v3 command-palette category
// "multiview". The installer also mounts QuadPanel into a body-attached
// host div positioned over the live renderer canvas, and chains into
// `__archdiscViewport.__studioAnimTick` with a tick fn tagged
// `__multiview` so the overlay's rect is re-synced + bounds-driven
// ortho cams are reframed every frame.
//
// Rendering swap pattern — we cannot reach inside Viewport3D.jsx (which
// owns the rAF loop), so we hijack the existing composer slot:
//
//   if (window.__archdiscViewport.__studioComposer) {
//     composer.render(); return;
//   }
//   renderer.render(scene, camera);
//
// On enable we save the prior composer in `_prevComposer`, install our
// own composer-shaped object whose `render()` calls `renderQuad()`.
// On disable we restore the prior composer (could be null or a real
// post-effects composer).

import React from 'react';
import { createRoot } from 'react-dom/client';

import QuadPanel from './QuadPanel.jsx';
import {
  createQuadState, setPerspCamera, renderQuad, keyToIndex,
} from './quadrender.js';

let _installed = false;
let _on = false;
let _state = null;            // QuadState — survives toggles
let _host = null;             // body-attached div
let _root = null;             // React root
let _prevComposer = undefined; // saved composer reference (undef = never set)
let _multiComposer = null;    // our render-takeover object

// ─── Op registration helper (matches animadv/index.js pattern) ──────
function reg(name, fn, description) {
  if (typeof window === 'undefined') return;
  window[name] = fn;
  const tryRegister = () => {
    if (typeof window.__studioCommandRegister === 'function') {
      try {
        window.__studioCommandRegister(name, fn, { category: 'multiview', description });
        return true;
      } catch (_) { /* swallow */ }
    }
    return false;
  };
  if (!tryRegister()) {
    setTimeout(tryRegister, 0);
  }
}

// ─── Canvas locator ─────────────────────────────────────────────────
function getCanvas() {
  const v = window.__archdiscViewport;
  if (v && v.renderer && v.renderer.domElement) return v.renderer.domElement;
  return null;
}
function getRenderer() {
  const v = window.__archdiscViewport;
  return v && v.renderer ? v.renderer : null;
}
function getScene() {
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}
function getViewportCamera() {
  const v = window.__archdiscViewport;
  return v && v.camera ? v.camera : null;
}

// ─── Overlay rect tracking ──────────────────────────────────────────
//
// The QuadPanel needs the canvas's bounding rect so its labels +
// splitters sit on top of the right pixels. We resync inside the
// per-frame __multiview tick (cheap — one getBoundingClientRect per
// frame) and only rerender React when the rect actually changes.
let _lastRect = { x: 0, y: 0, w: 0, h: 0 };
function readCanvasRect() {
  const c = getCanvas();
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    w: Math.round(r.width),
    h: Math.round(r.height),
  };
}
function rectsDiffer(a, b) {
  if (!a || !b) return true;
  return a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h;
}

// ─── Editor host ────────────────────────────────────────────────────
function mountHost() {
  if (typeof document === 'undefined') return null;
  if (_host) return _host;
  _host = document.createElement('div');
  _host.setAttribute('data-studio-v3-multiview-host', '');
  // The host itself is a 0x0 anchor — QuadPanel renders position:fixed
  // children, so the host doesn't need layout.
  _host.style.position = 'fixed';
  _host.style.left = '0';
  _host.style.top = '0';
  _host.style.width = '0';
  _host.style.height = '0';
  _host.style.pointerEvents = 'none';
  _host.style.zIndex = '50';
  document.body.appendChild(_host);
  _root = createRoot(_host);
  return _host;
}

function renderOverlay() {
  if (!_root) return;
  if (!_on) { _root.render(null); return; }
  const rect = readCanvasRect() || _lastRect;
  _root.render(
    React.createElement(QuadPanel, {
      canvasRect: rect,
      horizontalRatio: _state ? _state.horizontalRatio : 0.5,
      verticalRatio: _state ? _state.verticalRatio : 0.5,
      maximizedIdx: _state ? _state.maximizedIdx : -1,
      onSplitChange: (hR, vR) => {
        if (!_state) return;
        if (typeof hR === 'number') _state.horizontalRatio = hR;
        if (typeof vR === 'number') _state.verticalRatio = vR;
        renderOverlay();
      },
      onMaximize: (idx) => {
        if (!_state) return;
        _state.maximizedIdx = (_state.maximizedIdx === idx) ? -1 : idx;
        renderOverlay();
      },
      onClose: () => disable(),
    }),
  );
}

// ─── Per-frame tick — __multiview chain marker ──────────────────────
//
// Tagged so audit code can walk the tick chain and see our pipeline
// stage. Does only the cheap state work each frame:
//
//   • sync overlay rect if the canvas moved/resized
//   • refresh the persp camera reference if it changed
//
// The actual scissored render runs from the composer hook (below).
function installTickIfNeeded() {
  const v = window.__archdiscViewport;
  if (!v) return false;
  if (v.__studioAnimTick && v.__studioAnimTick.__multiview) return true;
  const prev = v.__studioAnimTick;
  const fn = (now) => {
    try {
      if (_on) {
        // Reframe persp ref if viewport camera switched out from under us.
        const cam = getViewportCamera();
        if (cam && _state && _state.panes[0] !== cam) setPerspCamera(_state, cam);
        // Resync overlay rect on canvas resize / window move.
        const rect = readCanvasRect();
        if (rect && rectsDiffer(rect, _lastRect)) {
          _lastRect = rect;
          renderOverlay();
        }
      }
    } catch (_) { /* swallow */ }
    if (prev) {
      try { prev(now); } catch (_) { /* swallow */ }
    }
  };
  fn.__multiview = true;
  fn.__prev = prev;
  v.__studioAnimTick = fn;
  return true;
}

function uninstallTick() {
  const v = window.__archdiscViewport;
  if (!v) return false;
  if (v.__studioAnimTick && v.__studioAnimTick.__multiview) {
    v.__studioAnimTick = v.__studioAnimTick.__prev || null;
    return true;
  }
  let head = v.__studioAnimTick;
  while (head && head.__prev) {
    if (head.__prev.__multiview) {
      head.__prev = head.__prev.__prev || null;
      return true;
    }
    head = head.__prev;
  }
  return false;
}

// ─── Render-takeover via the composer slot ──────────────────────────
//
// The Viewport3D render loop short-circuits to `composer.render()` when
// `__archdiscViewport.__studioComposer` is set, so we install a
// composer-shaped object whose render() does our four scissored draws.
// `__multiview = true` lets audit code distinguish us from a real
// EffectComposer.
function makeMultiComposer() {
  return {
    __multiview: true,
    render() {
      if (!_on || !_state) return;
      const renderer = getRenderer();
      const scene = getScene();
      const canvas = getCanvas();
      if (!renderer || !scene || !canvas) return;
      // Persp pane mirrors live viewport camera every render — orbit
      // controls / camera bookmarks etc. all keep working without a
      // tick-side sync.
      const cam = getViewportCamera();
      if (cam && _state.panes[0] !== cam) setPerspCamera(_state, cam);
      try {
        renderQuad(canvas, _state, renderer, scene);
      } catch (_) { /* swallow — never crash the rAF loop */ }
    },
  };
}

function installComposerTakeover() {
  const v = window.__archdiscViewport;
  if (!v) return false;
  // Save any prior composer ONCE so a double-enable doesn't lose it.
  if (_prevComposer === undefined) _prevComposer = v.__studioComposer || null;
  if (!_multiComposer) _multiComposer = makeMultiComposer();
  v.__studioComposer = _multiComposer;
  return true;
}

function uninstallComposerTakeover() {
  const v = window.__archdiscViewport;
  if (!v) return false;
  // Restore only if we are still the active composer — defensive
  // against external code swapping it (e.g. post-FX install) while we
  // were on.
  if (v.__studioComposer === _multiComposer) {
    v.__studioComposer = _prevComposer || null;
  }
  _prevComposer = undefined;
  return true;
}

// ─── Public toggle ops ──────────────────────────────────────────────
function enable() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (!_state) _state = createQuadState(getViewportCamera());
  else setPerspCamera(_state, getViewportCamera());
  mountHost();
  _on = true;
  installTickIfNeeded();
  installComposerTakeover();
  const rect = readCanvasRect();
  if (rect) _lastRect = rect;
  renderOverlay();
  return { ok: true, on: true };
}

function disable() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  _on = false;
  uninstallComposerTakeover();
  uninstallTick();
  renderOverlay();
  return { ok: true, on: false };
}

function toggle() {
  return _on ? disable() : enable();
}

function maximizePane(idx) {
  if (!_state) return { ok: false, error: 'multiview not initialized' };
  // Accept either numeric index or a pane key string.
  let i = (typeof idx === 'number') ? idx : keyToIndex(idx);
  if (i === -1 && idx === -1) i = -1;
  if (i < -1 || i > 3) return { ok: false, error: 'idx out of range (-1..3)' };
  _state.maximizedIdx = i;
  renderOverlay();
  return { ok: true, maximized: i };
}

function setSplit(h, v) {
  if (!_state) _state = createQuadState(getViewportCamera());
  if (typeof h === 'number' && Number.isFinite(h)) {
    _state.horizontalRatio = Math.max(0.05, Math.min(0.95, h));
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    _state.verticalRatio = Math.max(0.05, Math.min(0.95, v));
  }
  renderOverlay();
  return {
    ok: true,
    hRatio: _state.horizontalRatio,
    vRatio: _state.verticalRatio,
  };
}

function getState() {
  return {
    ok: true,
    on: _on,
    ratios: _state
      ? { horizontal: _state.horizontalRatio, vertical: _state.verticalRatio }
      : { horizontal: 0.5, vertical: 0.5 },
    maximized: _state ? _state.maximizedIdx : -1,
    panes: ['persp', 'top', 'front', 'right'],
  };
}

// ─── Install / uninstall ────────────────────────────────────────────
export function installMultiView() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  reg('__studioMultiViewToggle',       toggle,
      'Toggle Blender-style quad view (perspective + top/front/right ortho).');
  reg('__studioMultiViewEnable',       enable,
      'Enable quad-view 2×2 viewport split.');
  reg('__studioMultiViewDisable',      disable,
      'Disable quad view; restore single-pane render.');
  reg('__studioMultiViewMaximizePane', maximizePane,
      'Maximize a pane (0=persp, 1=top, 2=front, 3=right) or restore (-1).');
  reg('__studioMultiViewSetSplit',     setSplit,
      'Set splitter ratios: (horizontalRatio, verticalRatio) in 0.05..0.95.');
  reg('__studioMultiViewGetState',     getState,
      'Read quad-view on/off, ratios, maximized pane, and pane labels.');

  // Best-effort early install of the per-frame tick — viewport may not
  // exist at module-eval time; toggle() retries.
  installTickIfNeeded();

  return { ok: true, alreadyInstalled: false };
}

export function uninstallMultiView() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  // Make sure render takeover is unhooked even if the caller forgot
  // to disable() first.
  if (_on) {
    try { disable(); } catch (_) { /* swallow */ }
  }
  for (const k of [
    '__studioMultiViewToggle', '__studioMultiViewEnable', '__studioMultiViewDisable',
    '__studioMultiViewMaximizePane', '__studioMultiViewSetSplit',
    '__studioMultiViewGetState',
  ]) {
    try { delete window[k]; } catch (_) { /* swallow */ }
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(k); } catch (_) { /* swallow */ }
    }
  }
  uninstallTick();
  if (_root) {
    try { _root.unmount(); } catch (_) { /* swallow */ }
    _root = null;
  }
  if (_host && _host.parentNode) {
    _host.parentNode.removeChild(_host);
  }
  _host = null;
  _installed = false;
  _state = null;
  _multiComposer = null;
  return { ok: true };
}
