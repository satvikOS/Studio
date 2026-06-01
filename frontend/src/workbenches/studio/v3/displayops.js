// ArchDisc Studio V3 — display / view-time toggles.
//
//   __studioToggleCheatSheet — F1 keymap-cheatsheet overlay flip
//   __studioSetBgColor       — set viewport scene.background
//   __studioToggleLocalView  — Numpad-/ hide-others / reveal-all flip
//   __studioSyncDisplay      — broadcast a synthetic display-changed
//                              event (for UI listeners to re-render)

import * as THREE from 'three';

function scene() {
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}
function activeMesh() {
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}

function toggleCheatSheet() {
  const next = !window.__studioCheatSheetOpen;
  window.__studioCheatSheetOpen = next;
  window.dispatchEvent(new CustomEvent('studio-cheatsheet-toggle', { detail: { open: next } }));
  return { ok: true, open: next };
}

function setBgColor(hexOrColor) {
  const s = scene();
  if (!s) return { ok: false, error: 'no scene' };
  const col = (typeof hexOrColor === 'number' || typeof hexOrColor === 'string')
    ? new THREE.Color(hexOrColor)
    : null;
  if (!col) return { ok: false, error: 'bad color' };
  s.background = col;
  window.__studioBgColor = '#' + col.getHexString();
  return { ok: true, color: window.__studioBgColor };
}

function toggleLocalView() {
  const s = scene();
  if (!s) return { ok: false, error: 'no scene' };
  const sel = activeMesh();
  if (window.__studioLocalView) {
    s.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioPrimitive) o.visible = true;
    });
    window.__studioLocalView = false;
    return { ok: true, on: false };
  }
  if (!sel) return { ok: false, error: 'no selection' };
  let revealed = 0;
  s.traverse((o) => {
    if (o.userData && o.userData.archdiscStudioPrimitive) {
      const visible = (o.uuid === sel.uuid);
      o.visible = visible;
      if (visible) revealed++;
    }
  });
  window.__studioLocalView = true;
  return { ok: true, on: true, revealed };
}

function syncDisplay() {
  window.dispatchEvent(new CustomEvent('studio-display-sync', { detail: { ts: Date.now() } }));
  return { ok: true };
}

export function registerDisplayOps() {
  window.__studioToggleCheatSheet = toggleCheatSheet;
  window.__studioSetBgColor       = setBgColor;
  window.__studioToggleLocalView  = toggleLocalView;
  window.__studioSyncDisplay      = syncDisplay;
}

export function unregisterDisplayOps() {
  for (const k of [
    '__studioToggleCheatSheet', '__studioSetBgColor',
    '__studioToggleLocalView', '__studioSyncDisplay',
  ]) { try { delete window[k]; } catch (_) {} }
}
