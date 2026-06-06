// ArchDisc Studio V3 — Asset Library installer (slice 771).
//
// Wires the asset-catalog ops onto window so the cmd palette, menubar,
// and e2e specs can list / search / spawn assets without having to
// import the catalog module. The actual scene-side spawn happens here
// (the catalog returns a bare Object3D — the installer parents it to
// `window.__archdiscScene`, optionally repositions it, pushes an undo
// entry, and selects the resulting mesh).
//
// Ops registered (the slice 771 spec named them __studioAssetList /
// Spawn / Search / Tags / Categories / AddCustom; the bare __studioAsset*
// slots were already in use by slice 666's localStorage-backed asset
// vault — `__studioAssetSave`, `__studioAssetList(tagFilter)`,
// `__studioAssetInstantiate`, `__studioAssetDelete`, `__studioAssetRetag`,
// `__studioAssetListTags` — and the assetbrowser panel (slice 668)
// depends on those exact signatures. So this catalog lives at
// `__studioAssetLib*` slots, side-by-side with the vault, exposing the
// spec'd semantics without breaking any existing caller):
//
//   __studioAssetLibList({category?, tag?, search?})  → {ok, items:[{id, name, category, tags}]}
//   __studioAssetLibSpawn({assetId, position?})       → {ok, uuid}
//   __studioAssetLibSearch({query})                   → {ok, items}
//   __studioAssetLibTags()                            → {ok, tags:[]}
//   __studioAssetLibCategories()                      → {ok, categories:[]}
//   __studioAssetLibAddCustom({name, category, tags, geometry}) → {ok, assetId}
//
// All six register under category 'assetlib' via common/registry.js so
// they show up in the palette alongside slice-666 asset CRUD and
// slice-668 Asset Browser panel.

import {
  listAssets, findAsset, listCategories, listTags, filter, addCustom,
  __seedCounts,
} from './assets.js';
import { registerOps, unregisterOps } from '../common/registry.js';

let _installed = false;

function _projection(a) {
  return { id: a.id, name: a.name, category: a.category, tags: (a.tags || []).slice() };
}

function _getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

// ─── Op implementations ──────────────────────────────────────────────────
function listOp(args) {
  const opts = (args && typeof args === 'object') ? args : {};
  const list = filter(opts);
  return {
    ok: true,
    count: list.length,
    total: listAssets().length,
    items: list.map(_projection),
  };
}

function spawnOp(args) {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  const opts = (args && typeof args === 'object') ? args : {};
  const assetId = opts.assetId;
  if (!assetId) return { ok: false, error: 'assetId required' };
  const asset = findAsset(assetId);
  if (!asset) return { ok: false, error: 'asset not found: ' + assetId };
  const scene = _getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  // Push an undo entry so a spam-spawn run can be rolled back.
  if (typeof window.__studioPushUndo === 'function') {
    try { window.__studioPushUndo(); } catch (_) { /* swallow */ }
  }
  let obj;
  try {
    obj = asset.spawn();
  } catch (e) {
    return { ok: false, error: 'spawn threw: ' + (e && e.message ? e.message : String(e)) };
  }
  if (!obj) return { ok: false, error: 'spawn returned null' };
  // Position override — Array [x,y,z] or {x,y,z}.
  const pos = opts.position;
  if (pos != null) {
    let px = 0, py = 0, pz = 0;
    if (Array.isArray(pos)) {
      px = Number(pos[0]) || 0;
      py = Number(pos[1]) || 0;
      pz = Number(pos[2]) || 0;
    } else if (typeof pos === 'object') {
      px = Number(pos.x) || 0;
      py = Number(pos.y) || 0;
      pz = Number(pos.z) || 0;
    }
    if (typeof obj.position?.set === 'function') {
      obj.position.set(px, py, pz);
    }
  }
  obj.name = obj.name || `${asset.id}-${Date.now().toString(36)}`;
  scene.add(obj);
  // Some lights (SpotLight) carry a `.target` Object3D that must also
  // join the scene or the cone aims nowhere.
  if (obj.target && obj.target.isObject3D && !obj.target.parent) {
    scene.add(obj.target);
  }
  // Auto-select the spawned object if it's a mesh (matches the
  // primitive-spawn convention).
  if (obj.isMesh && typeof window.__studioSelectMesh === 'function') {
    try { window.__studioSelectMesh(obj); } catch (_) { /* swallow */ }
  }
  return { ok: true, uuid: obj.uuid, assetId: asset.id, name: asset.name, category: asset.category };
}

function searchOp(args) {
  const opts = (args && typeof args === 'object') ? args : {};
  const q = opts.query != null ? opts.query : opts.q;
  const list = filter({ search: q });
  return { ok: true, count: list.length, query: String(q || ''), items: list.map(_projection) };
}

function tagsOp() {
  return { ok: true, tags: listTags() };
}

function categoriesOp() {
  return { ok: true, categories: listCategories() };
}

function addCustomOp(args) {
  const opts = (args && typeof args === 'object') ? args : {};
  const e = addCustom({
    name: opts.name,
    category: opts.category,
    tags: opts.tags,
    geometry: opts.geometry,
    build: opts.build,
  });
  return { ok: true, assetId: e.id, name: e.name, category: e.category, tags: e.tags.slice() };
}

// ─── Install ─────────────────────────────────────────────────────────────
export function installAssetLib() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioAssetLibInstalled) {
    return { ok: true, already: true, count: listAssets().length };
  }
  _installed = true;
  window.__studioAssetLibInstalled = true;

  registerOps({
    __studioAssetLibList: [listOp,
      'Asset Library — list catalog entries with optional {category, tag, search} filter; returns {id, name, category, tags}[]'],
    __studioAssetLibSpawn: [spawnOp,
      'Asset Library — spawn an asset into the active scene at an optional {assetId, position} world coordinate.'],
    __studioAssetLibSearch: [searchOp,
      'Asset Library — substring-match the catalog by name / id / category / tag; returns the same projection as Library list.'],
    __studioAssetLibTags: [tagsOp,
      'Asset Library — list every unique tag across the catalog (sorted).'],
    __studioAssetLibCategories: [categoriesOp,
      'Asset Library — list every unique category across the catalog (sorted).'],
    __studioAssetLibAddCustom: [addCustomOp,
      'Asset Library — register a user-supplied asset {name, category, tags, geometry}; returns the assignable assetId.'],
  }, 'assetlib', 'Asset Library (slice 771) — catalog of primitives / lights / cameras / materials.');

  return { ok: true, count: listAssets().length, seedCounts: { ...__seedCounts } };
}

export function uninstallAssetLib() {
  if (!_installed) return { ok: true };
  unregisterOps([
    '__studioAssetLibList', '__studioAssetLibSpawn', '__studioAssetLibSearch',
    '__studioAssetLibTags', '__studioAssetLibCategories', '__studioAssetLibAddCustom',
  ]);
  _installed = false;
  if (typeof window !== 'undefined') window.__studioAssetLibInstalled = false;
  return { ok: true };
}

export default installAssetLib;
