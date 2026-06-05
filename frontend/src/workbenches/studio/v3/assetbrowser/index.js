// ArchDisc Studio V3 — Asset Browser installer.
//
// installAssetBrowser() is idempotent. Wires window.__studioAssetBrowser*
// ops, mounts the React panel into a body-attached host (so we never
// touch StudioShellV3.jsx), and auto-registers each op under category
// 'assetbrowser' with the V3 command palette.
//
// Wraps slice-666 asset CRUD (__studioAssetSave / List / Instantiate /
// Delete / Retag / ListTags) and slice-671 thumbnail generator.

import React from 'react';
import AssetBrowserPanel, { filterAssets } from './AssetBrowserPanel.jsx';
import {
  ensureThumb, clearThumb, setThumb, clearAllThumbs,
  thumbCount, listThumbNames,
} from './thumbCache.js';
import { mountPanel, unmountPanel } from '../common/panel.js';
import { registerOp, unregisterOps } from '../common/registry.js';

let _installed = false;
let _panel = null;
let _open = false;
let _state = { search: '', filter: '', refreshKey: 0 };

// ─── Helpers ─────────────────────────────────────────────────────────────
function _safe(fnName, ...args) {
  if (typeof window === 'undefined') return null;
  const f = window[fnName];
  if (typeof f !== 'function') return null;
  try { return f(...args); } catch (_) { return null; }
}

function _readAssets() {
  const r = _safe('__studioAssetList');
  return (r && r.ok && r.items) || [];
}

function _readTags() {
  const r = _safe('__studioAssetListTags');
  return (r && r.ok && r.tags) || [];
}

// ─── Mount control ───────────────────────────────────────────────────────
function ensureHost() {
  if (_panel) return _panel.host;
  _panel = mountPanel('assetbrowser');
  return _panel ? _panel.host : null;
}

function render() {
  if (!_panel) return;
  if (!_open) { _panel.render(null); return; }
  _panel.render(
    React.createElement(AssetBrowserPanel, {
      search: _state.search,
      filter: _state.filter,
      refreshKey: _state.refreshKey,
      onSearchChange: (q) => { _state.search = String(q || ''); render(); },
      onFilterChange: (t) => { _state.filter = String(t || ''); render(); },
      onInstantiate: instantiateOp,
      onSaveSelection: (name, tag) => saveSelectionOp(name, tag),
      onDelete: deleteOp,
      onRetag: retagOp,
      onRefreshThumbs: () => { refreshThumbsOp(); },
      onCloseRequest: () => browserClose(),
    }),
  );
}

function _bumpRefresh() {
  _state.refreshKey++;
}

// ─── Op implementations ──────────────────────────────────────────────────
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

function setFilterOp(tag) {
  _state.filter = String(tag || '');
  render();
  return { ok: true, filter: _state.filter };
}

function setSearchOp(query) {
  _state.search = String(query || '');
  render();
  return { ok: true, search: _state.search };
}

function listVisibleOp() {
  const assets = _readAssets();
  const items = filterAssets(assets, _state.filter, _state.search);
  return {
    ok: true,
    count: items.length,
    total: assets.length,
    filter: _state.filter,
    search: _state.search,
    items: items.map((a) => ({ name: a.name, tag: a.tag || '' })),
  };
}

function refreshThumbsOp() {
  const assets = _readAssets();
  let warmed = 0;
  for (const a of assets) {
    // Force a re-pull from the live renderer / placeholder fallback.
    clearThumb(a.name);
    const url = ensureThumb(a.name, a.tag);
    if (url) warmed++;
  }
  _bumpRefresh();
  render();
  return { ok: true, warmed, cached: thumbCount() };
}

function instantiateOp(asset, worldOrOffset) {
  if (!asset || !asset.name) return { ok: false, error: 'no asset' };
  if (typeof window === 'undefined' || typeof window.__studioAssetInstantiate !== 'function') {
    return { ok: false, error: 'asset api missing' };
  }
  if (Array.isArray(worldOrOffset)) {
    // Caller already computed a target world position — convert it to an
    // offset relative to the snapshot's stored position so the
    // slice-666 implementation lands the mesh exactly where requested.
    try {
      const raw = window.localStorage.getItem('studio.v3.assets.' + asset.name);
      if (raw) {
        const snap = JSON.parse(raw);
        const base = snap.position || [0, 0, 0];
        const off = [
          worldOrOffset[0] - base[0],
          worldOrOffset[1] - base[1],
          worldOrOffset[2] - base[2],
        ];
        const p = window.__studioAssetInstantiate(asset.name, off);
        return Promise.resolve(p).then((r) => r || { ok: false });
      }
    } catch (_) { /* fall through to default-offset call */ }
  }
  // No world target → fall through with a tiny default offset so the
  // origin-spawned mesh isn't z-fighting with an existing instance.
  const p = window.__studioAssetInstantiate(asset.name, [0, 0, 0]);
  return Promise.resolve(p).then((r) => r || { ok: false });
}

function deleteOp(name) {
  const r = _safe('__studioAssetDelete', name);
  clearThumb(name);
  _bumpRefresh();
  render();
  return r || { ok: false };
}

function retagOp(name, tag) {
  const r = _safe('__studioAssetRetag', name, tag);
  clearThumb(name);
  _bumpRefresh();
  render();
  return r || { ok: false };
}

function saveSelectionOp(name, tag) {
  if (typeof window === 'undefined') return { ok: false };
  const save = window.__studioAssetSave;
  if (typeof save !== 'function') return { ok: false, error: 'slice-666 asset api missing' };
  const r = save(name, tag);
  if (r && r.ok) {
    // Best-effort thumbnail warm-up. The saved snapshot's source mesh
    // is still the active selection so slice-671 will render it.
    const sel = typeof window.__studioSelectedMesh === 'function'
      ? window.__studioSelectedMesh() : null;
    if (sel && typeof window.__studioGenerateThumbnail === 'function') {
      try {
        const t = window.__studioGenerateThumbnail(sel.uuid, 96, 96);
        if (t && t.ok && t.dataUrl) setThumb(r.name, t.dataUrl);
      } catch (_) { /* fall through to placeholder */ }
    }
    if (!_safe('__studioAssetBrowserGetThumb', r.name)) ensureThumb(r.name, r.tag);
    _bumpRefresh();
    render();
  }
  return r || { ok: false };
}

// ─── Install ─────────────────────────────────────────────────────────────
export function installAssetBrowser() {
  if (typeof window === 'undefined') return { ok: false };
  if (_installed) return { ok: true, already: true };
  _installed = true;

  window.__studioAssetBrowserOpen = browserOpen;
  window.__studioAssetBrowserClose = browserClose;
  window.__studioAssetBrowserToggle = browserToggle;
  window.__studioAssetBrowserSetFilter = setFilterOp;
  window.__studioAssetBrowserSetSearch = setSearchOp;
  window.__studioAssetBrowserListVisible = listVisibleOp;
  window.__studioAssetBrowserRefreshThumbs = refreshThumbsOp;
  window.__studioAssetBrowserSaveSelection = saveSelectionOp;
  // Convenience ops surfaced for tests + the cmd palette but kept off
  // the spec's mandatory op list.
  window.__studioAssetBrowserInstantiate = (name, world) => instantiateOp({ name }, world);
  window.__studioAssetBrowserDelete = deleteOp;
  window.__studioAssetBrowserRetag = retagOp;
  window.__studioAssetBrowserGetThumb = (name) => {
    const url = ensureThumb(name, '');
    return url ? { ok: true, dataUrl: url } : { ok: false };
  };
  window.__studioAssetBrowserClearCache = () => {
    const n = thumbCount();
    clearAllThumbs();
    _bumpRefresh();
    render();
    return { ok: true, cleared: n };
  };
  window.__studioAssetBrowserListTags = () => ({ ok: true, tags: _readTags() });
  window.__studioAssetBrowserIsOpen = () => ({ ok: true, open: _open });
  window.__studioAssetBrowserListCachedThumbs = () => ({
    ok: true, count: thumbCount(), names: listThumbNames(),
  });

  // Hotkey: Escape closes the browser when focus isn't in an input.
  const onKey = (e) => {
    const ae = document.activeElement;
    if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
    if (e.key === 'Escape' && _open) { browserClose(); e.preventDefault(); }
  };
  window.addEventListener('keydown', onKey);

  // Auto-register every op under category 'assetbrowser' via common/registry.js.
  const entries = [
    ['__studioAssetBrowserOpen',          'Open the Asset Browser panel'],
    ['__studioAssetBrowserClose',         'Close the Asset Browser panel'],
    ['__studioAssetBrowserToggle',        'Toggle the Asset Browser panel'],
    ['__studioAssetBrowserSetFilter',     'Filter the asset grid by tag (empty = all)'],
    ['__studioAssetBrowserSetSearch',     'Filter the asset grid by name/tag substring'],
    ['__studioAssetBrowserListVisible',   'Return assets currently visible under the active filter / search'],
    ['__studioAssetBrowserRefreshThumbs', 'Re-warm thumbnail cache for every saved asset'],
    ['__studioAssetBrowserSaveSelection', 'Save the active selection as a named asset + warm its thumbnail'],
    ['__studioAssetBrowserInstantiate',   'Instantiate a saved asset by name at a world position'],
    ['__studioAssetBrowserDelete',        'Delete a saved asset by name'],
    ['__studioAssetBrowserRetag',         'Set the tag for a saved asset'],
    ['__studioAssetBrowserGetThumb',      'Return the cached / placeholder thumbnail dataURL for an asset'],
    ['__studioAssetBrowserClearCache',    'Clear the in-memory thumbnail cache'],
    ['__studioAssetBrowserListTags',      'List every tag currently in use across saved assets'],
    ['__studioAssetBrowserIsOpen',        'Return whether the Asset Browser panel is open'],
    ['__studioAssetBrowserListCachedThumbs', 'List asset names currently warm in the thumb cache'],
  ];
  for (const [name, desc] of entries) {
    registerOp(name, window[name], 'assetbrowser', desc);
  }

  return { ok: true, ops: 16 };
}

export function uninstallAssetBrowser() {
  if (!_installed) return { ok: true };
  _installed = false;
  unregisterOps([
    '__studioAssetBrowserOpen', '__studioAssetBrowserClose', '__studioAssetBrowserToggle',
    '__studioAssetBrowserSetFilter', '__studioAssetBrowserSetSearch',
    '__studioAssetBrowserListVisible', '__studioAssetBrowserRefreshThumbs',
    '__studioAssetBrowserSaveSelection', '__studioAssetBrowserInstantiate',
    '__studioAssetBrowserDelete', '__studioAssetBrowserRetag',
    '__studioAssetBrowserGetThumb', '__studioAssetBrowserClearCache',
    '__studioAssetBrowserListTags', '__studioAssetBrowserIsOpen',
    '__studioAssetBrowserListCachedThumbs',
  ]);
  if (_panel) { unmountPanel('assetbrowser'); _panel = null; }
  _open = false;
  clearAllThumbs();
  return { ok: true };
}
