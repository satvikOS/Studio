// ArchDisc Studio V3 — Material Library installer.
//
// installMatLib() is idempotent. Wires every op described in the slice
// brief, mounts the React MaterialBrowser into a body-attached host
// (so we never touch StudioShellV3.jsx), and registers each preset as
// its own command-palette entry under category 'matlib'.

import React from 'react';
import {
  RECIPES, CATEGORIES, recipesByCategory, findRecipe,
  countByCategory, safeIdSuffix,
} from './library.js';
import { applyRecipe } from './applyToSelection.js';
import MaterialBrowser, { disposeThumbnailer } from './MaterialBrowser.jsx';
import { mountPanel, unmountPanel } from '../common/panel.js';
import { registerOp, unregisterOps } from '../common/registry.js';

let _installed = false;
let _panel = null;
let _open = false;

// ─── Browser mount control ───────────────────────────────────────────────
function ensureHost() {
  if (_panel) return _panel.host;
  _panel = mountPanel('matlib');
  return _panel ? _panel.host : null;
}

function render() {
  if (!_panel) return;
  if (!_open) { _panel.render(null); return; }
  _panel.render(
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

  // Register with the V3 command palette via common/registry.js, which
  // handles cold-start retry for both the per-preset ops and the generic
  // ones.
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
    registerOp(name, window[name], 'matlib', desc);
  }
  for (const [fnName, recipe] of perPresetNames) {
    registerOp(fnName, window[fnName], 'matlib',
      `Apply ${recipe.name} (${recipe.category}) to selection`);
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
  unregisterOps([
    '__studioMatLibList', '__studioMatLibApply', '__studioMatLibListCategories',
    '__studioMatLibBrowserOpen', '__studioMatLibBrowserClose', '__studioMatLibBrowserToggle',
    '__studioMatLibCount', '__studioMatLibFind',
  ]);
  unregisterOps(RECIPES.map((r) => `__studioMatLib_${safeIdSuffix(r.id)}`));
  if (_panel) { unmountPanel('matlib'); _panel = null; }
  _open = false;
  try { disposeThumbnailer(); } catch (_) {}
  return { ok: true };
}
