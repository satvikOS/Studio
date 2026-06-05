// ArchDisc Studio V3 — Material Library installer.
//
// installMatLib() is idempotent. Wires every op described in the slice
// brief, mounts the React MaterialBrowser into a body-attached host
// (so we never touch StudioShellV3.jsx), and registers each preset as
// its own command-palette entry under category 'matlib'.

import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  RECIPES, CATEGORIES, recipesByCategory, findRecipe,
  countByCategory, safeIdSuffix,
} from './library.js';
import { applyRecipe } from './applyToSelection.js';
import MaterialBrowser, { disposeThumbnailer } from './MaterialBrowser.jsx';

let _installed = false;
let _host = null;
let _root = null;
let _open = false;

// ─── Browser mount control ───────────────────────────────────────────────
function ensureHost() {
  if (typeof document === 'undefined') return null;
  if (_host) return _host;
  _host = document.createElement('div');
  _host.setAttribute('data-studio-v3-matlib-host', '');
  document.body.appendChild(_host);
  _root = createRoot(_host);
  return _host;
}

function render() {
  if (!_root) return;
  if (!_open) { _root.render(null); return; }
  _root.render(
    React.createElement(MaterialBrowser, {
      onApply: (id) => {
        const r = applyRecipe(id);
        if (typeof window !== 'undefined' && window.__studioToast) {
          if (r.ok) window.__studioToast(`Applied ${r.name}`, 'info');
          else window.__studioToast(r.error || 'No selection', 'warning');
        }
        return r;
      },
      onCloseRequest: () => browserClose(),
    }),
  );
}

function browserOpen() {
  ensureHost();
  _open = true;
  render();
  return { ok: true, open: true };
}

function browserClose() {
  _open = false;
  render();
  return { ok: true, open: false };
}

function browserToggle() {
  return _open ? browserClose() : browserOpen();
}

// ─── Op implementations ──────────────────────────────────────────────────
function listOp(category) {
  const list = recipesByCategory(category);
  return {
    ok: true,
    count: list.length,
    recipes: list.map((r) => ({
      id: r.id, name: r.name, category: r.category, params: { ...r.params },
    })),
  };
}

function applyOp(recipeId) {
  return applyRecipe(recipeId);
}

function listCategoriesOp() {
  return { ok: true, count: CATEGORIES.length, categories: CATEGORIES.slice() };
}

function countOp() {
  return { ok: true, total: RECIPES.length, byCategory: countByCategory() };
}

// ─── Install ─────────────────────────────────────────────────────────────
export function installMatLib() {
  if (typeof window === 'undefined') return { ok: false };
  if (_installed) return { ok: true, already: true, presets: RECIPES.length };
  _installed = true;

  // Generic ops.
  window.__studioMatLibList = listOp;
  window.__studioMatLibApply = applyOp;
  window.__studioMatLibListCategories = listCategoriesOp;
  window.__studioMatLibBrowserOpen = browserOpen;
  window.__studioMatLibBrowserClose = browserClose;
  window.__studioMatLibBrowserToggle = browserToggle;
  window.__studioMatLibCount = countOp;
  window.__studioMatLibFind = (id) => {
    const r = findRecipe(id);
    return r ? { ok: true, recipe: { ...r, params: { ...r.params } } } : { ok: false, error: 'unknown' };
  };

  // Per-preset apply ops. Auto-register so each preset surfaces in the
  // command palette + menubar individually.
  const perPresetNames = [];
  for (const recipe of RECIPES) {
    const fnName = `__studioMatLib_${safeIdSuffix(recipe.id)}`;
    const fn = () => applyRecipe(recipe.id);
    window[fnName] = fn;
    perPresetNames.push([fnName, recipe]);
  }

  // Hotkey: Escape closes the browser when focus isn't in an input.
  const onKey = (e) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.key === 'Escape' && _open) { browserClose(); e.preventDefault(); }
  };
  window.addEventListener('keydown', onKey);

  // Register with the V3 command palette if available. The shader
  // installer uses the same defensive check — registry may not exist
  // yet during very early boots.
  const reg = window.__studioCommandRegister;
  if (typeof reg === 'function') {
    const cat = 'matlib';
    const generics = [
      ['__studioMatLibList',            'List matlib recipes (optionally filtered by category)'],
      ['__studioMatLibApply',           'Apply a matlib recipe id to the active selection'],
      ['__studioMatLibListCategories',  'List matlib categories'],
      ['__studioMatLibBrowserOpen',     'Open the Material Browser panel'],
      ['__studioMatLibBrowserClose',    'Close the Material Browser panel'],
      ['__studioMatLibBrowserToggle',   'Toggle the Material Browser panel'],
      ['__studioMatLibCount',           'Return total + per-category recipe counts'],
      ['__studioMatLibFind',            'Look up a single recipe by id'],
    ];
    for (const [name, desc] of generics) {
      try { reg(name, window[name], { category: cat, description: desc }); } catch (_) { /* swallow */ }
    }
    for (const [fnName, recipe] of perPresetNames) {
      try {
        reg(fnName, window[fnName], {
          category: cat,
          description: `Apply ${recipe.name} (${recipe.category}) to selection`,
        });
      } catch (_) { /* swallow */ }
    }
  }

  return {
    ok: true,
    presets: RECIPES.length,
    categories: CATEGORIES.length,
    perPresetOps: perPresetNames.length,
  };
}

// Mostly for tests / hot-reload scenarios.
export function uninstallMatLib() {
  if (!_installed) return { ok: true };
  _installed = false;
  const keys = [
    '__studioMatLibList', '__studioMatLibApply', '__studioMatLibListCategories',
    '__studioMatLibBrowserOpen', '__studioMatLibBrowserClose', '__studioMatLibBrowserToggle',
    '__studioMatLibCount', '__studioMatLibFind',
  ];
  for (const k of keys) { try { delete window[k]; } catch (_) {} }
  for (const r of RECIPES) {
    try { delete window[`__studioMatLib_${safeIdSuffix(r.id)}`]; } catch (_) {}
  }
  if (_root) { try { _root.unmount(); } catch (_) {} _root = null; }
  if (_host && _host.parentNode) _host.parentNode.removeChild(_host);
  _host = null; _open = false;
  try { disposeThumbnailer(); } catch (_) {}
  return { ok: true };
}
