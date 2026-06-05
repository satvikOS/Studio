// ArchDisc Studio V3 — projection-paint pointer driver.
//
// While paint mode is active:
//   • orbitControls.enabled is forced false (so dragging paints rather
//     than orbits)
//   • pointerdown + pointermove call pickAtScreen → stampAt on the hit
//   • pointerup releases capture
//   • cursor is set to 'crosshair'
//
// Exiting paint mode restores the prior orbit state + cursor. All
// listeners are bound on `window` (capture phase) so we beat the orbit
// controls handler on the canvas.
//
// Idempotent: install() / uninstall() can be called repeatedly. The
// install records the bound listeners so uninstall removes the exact
// same references.
//
// We deliberately do NOT call setState anywhere — see
// `feedback-studio-window-api-no-setstate.md`: React re-renders can
// nuke the window.__studioPaintProj* functions and break e2e specs.

import { pickAtScreen } from './raycaster.js';
import { stampAt } from './canvasPaint.js';

const _state = {
  installed: false,
  active:    false,          // paint mode on/off
  dom:       null,           // renderer.domElement
  onDown:    null,
  onMove:    null,
  onUp:      null,
  onLeave:   null,
  dragging:  false,
  // Cached prior orbit state so we restore it on exit.
  prevOrbit: null,
  prevCursor: '',
  // Brush settings shared with the React panel.
  brush: { size: 28, color: '#ff5577', opacity: 0.9, hardness: 0.5 },
  // Stats — useful for tests + the panel UI.
  stats: { downs: 0, moves: 0, hits: 0, misses: 0 },
};

function _vp() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscViewport || null;
}

function _dom() {
  const v = _vp();
  if (!v || !v.renderer) return null;
  return v.renderer.domElement || null;
}

function _orbit() {
  const v = _vp();
  return (v && v.orbitControls) || null;
}

function _disableOrbit() {
  const o = _orbit();
  if (!o) { _state.prevOrbit = null; return; }
  _state.prevOrbit = !!o.enabled;
  o.enabled = false;
}

function _restoreOrbit() {
  const o = _orbit();
  if (!o || _state.prevOrbit == null) return;
  o.enabled = _state.prevOrbit;
  _state.prevOrbit = null;
}

function _stampAtEvent(ev) {
  const r = pickAtScreen(ev.clientX, ev.clientY);
  if (!r || !r.ok) { _state.stats.misses++; return null; }
  _state.stats.hits++;
  const b = _state.brush;
  stampAt(r.mesh, r.uv, b.color, b.size, b.opacity, b.hardness);
  return r;
}

function onDown(ev) {
  if (!_state.active) return;
  if (ev.button != null && ev.button !== 0) return;
  _state.dragging = true;
  _state.stats.downs++;
  _stampAtEvent(ev);
  try {
    if (ev.target && typeof ev.target.setPointerCapture === 'function' && ev.pointerId != null) {
      ev.target.setPointerCapture(ev.pointerId);
    }
  } catch (_) {}
  ev.preventDefault();
  ev.stopPropagation();
}

function onMove(ev) {
  if (!_state.active || !_state.dragging) return;
  _state.stats.moves++;
  _stampAtEvent(ev);
  ev.preventDefault();
}

function onUp(ev) {
  if (!_state.active) return;
  _state.dragging = false;
  try {
    if (ev && ev.target && typeof ev.target.releasePointerCapture === 'function' && ev.pointerId != null) {
      ev.target.releasePointerCapture(ev.pointerId);
    }
  } catch (_) {}
}

function onLeave() { _state.dragging = false; }

// ─── Public API ─────────────────────────────────────────────────────────

export function install() {
  if (_state.installed) return { ok: true, alreadyInstalled: true };
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  _state.onDown  = onDown;
  _state.onMove  = onMove;
  _state.onUp    = onUp;
  _state.onLeave = onLeave;
  // Bind on window (capture) so we beat the orbit-controls bubble listener.
  window.addEventListener('pointerdown',   _state.onDown,  true);
  window.addEventListener('pointermove',   _state.onMove,  true);
  window.addEventListener('pointerup',     _state.onUp,    true);
  window.addEventListener('pointercancel', _state.onUp,    true);
  window.addEventListener('pointerleave',  _state.onLeave, true);
  _state.installed = true;
  return { ok: true };
}

export function uninstall() {
  if (!_state.installed) return { ok: true, alreadyUninstalled: true };
  try { window.removeEventListener('pointerdown',   _state.onDown,  true); } catch (_) {}
  try { window.removeEventListener('pointermove',   _state.onMove,  true); } catch (_) {}
  try { window.removeEventListener('pointerup',     _state.onUp,    true); } catch (_) {}
  try { window.removeEventListener('pointercancel', _state.onUp,    true); } catch (_) {}
  try { window.removeEventListener('pointerleave',  _state.onLeave, true); } catch (_) {}
  if (_state.active) exitPaintMode();
  _state.installed = false;
  return { ok: true };
}

export function enterPaintMode() {
  install();
  _state.active = true;
  _state.dragging = false;
  _disableOrbit();
  const dom = _dom();
  if (dom) {
    _state.prevCursor = dom.style.cursor || '';
    dom.style.cursor = 'crosshair';
    _state.dom = dom;
  }
  return { ok: true, active: true };
}

export function exitPaintMode() {
  _state.active = false;
  _state.dragging = false;
  _restoreOrbit();
  const dom = _state.dom || _dom();
  if (dom) dom.style.cursor = _state.prevCursor || '';
  _state.dom = null;
  return { ok: true, active: false };
}

export function setBrush(partial) {
  if (!partial || typeof partial !== 'object') return { ok: false };
  const b = _state.brush;
  if (typeof partial.size    === 'number') b.size    = Math.max(1, partial.size);
  if (typeof partial.color   === 'string') b.color   = partial.color;
  if (typeof partial.opacity === 'number') b.opacity = Math.max(0, Math.min(1, partial.opacity));
  if (typeof partial.hardness === 'number') b.hardness = Math.max(0, Math.min(1, partial.hardness));
  return { ok: true, brush: getBrush() };
}

export function getBrush() {
  return { ..._state.brush };
}

export function isActive() { return !!_state.active; }
export function isDragging() { return !!_state.dragging; }
export function getStats() { return { ..._state.stats }; }

// Test helper — programmatically inject a synthetic pointer position
// without firing a real DOM event.  Useful for the e2e spec since it
// covers the pick + stamp without depending on dispatchEvent quirks.
export function _injectClickAt(clientX, clientY) {
  if (!_state.active) return { ok: false, error: 'paint mode off' };
  const r = pickAtScreen(clientX, clientY);
  if (!r || !r.ok) return r || { ok: false };
  const b = _state.brush;
  stampAt(r.mesh, r.uv, b.color, b.size, b.opacity, b.hardness);
  return { ok: true, uv: r.uv, meshUuid: r.meshUuid };
}
