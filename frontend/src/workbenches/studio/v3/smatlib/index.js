// ArchDisc Studio V3 — Substance Painter smart-material library
// installer (slice 769).
//
// installSMatLib() is idempotent. Wires the four op surfaces described
// in the slice brief:
//   __studioSMatList()        → { ok, presets:[{name, category}] }
//   __studioSMatApply({meshUuid, name}) → { ok, applied }
//   __studioSMatPreview({name})         → { ok, values:{...} }
//   __studioSMatCategories()  → { ok, categories:[] }
//
// All four also flow through common/registry so they surface in the
// command palette + menubar under the 'texpaint' category alongside the
// slice-726 Substance Painter smart-material ops.

import { registerOps } from '../common/registry.js';
import {
  SMART_PRESETS, SMART_CATEGORIES, findPreset, presetCount,
} from './presets.js';
import { applySmartMaterial, previewSmartMaterial } from './applyPreset.js';

let _installed = false;

// ─── Op implementations ──────────────────────────────────────────────────
function listOp() {
  return {
    ok: true,
    count: SMART_PRESETS.length,
    presets: SMART_PRESETS.map((p) => ({ name: p.name, category: p.category })),
  };
}

function applyOp(arg) {
  // Accept the standard `{meshUuid, name}` map AND fall through to a
  // looser shape so callers can pass `(uuid, name)` positional too.
  let meshUuid = null;
  let name = null;
  if (arg && typeof arg === 'object') {
    meshUuid = arg.meshUuid != null ? arg.meshUuid : arg.uuid;
    name = arg.name != null ? arg.name : arg.preset;
  }
  if (!meshUuid) {
    // Fall back to the active selection if the caller didn't supply a
    // uuid (mirrors __studioMatLibApply behaviour).
    if (typeof window !== 'undefined') {
      let mesh = null;
      if (typeof window.__studioSelectedMesh === 'function') {
        try { mesh = window.__studioSelectedMesh(); } catch (_) {}
      }
      if (!mesh) {
        const vp = window.__archdiscViewport;
        if (vp && vp.getSelected) mesh = vp.getSelected();
      }
      if (mesh && mesh.uuid) meshUuid = mesh.uuid;
    }
  }
  if (!meshUuid) return { ok: false, error: 'no mesh' };
  if (!name) return { ok: false, error: 'no preset name' };
  return applySmartMaterial(meshUuid, name);
}

function previewOp(arg) {
  const name = (arg && typeof arg === 'object') ? (arg.name || arg.preset) : arg;
  if (!name) return { ok: false, error: 'no preset name' };
  return previewSmartMaterial(name);
}

function categoriesOp() {
  return { ok: true, categories: SMART_CATEGORIES.slice(), count: SMART_CATEGORIES.length };
}

// ─── Install ─────────────────────────────────────────────────────────────
export function installSMatLib() {
  if (typeof window === 'undefined') return { ok: false };
  if (_installed) return { ok: true, already: true, presets: presetCount() };
  _installed = true;

  const ops = {
    __studioSMatList: [listOp, 'List Substance smart-material presets'],
    __studioSMatApply: [applyOp, 'Apply a smart-material preset to a mesh (by uuid or active selection)'],
    __studioSMatPreview: [previewOp, 'Preview a smart-material preset (return the param map)'],
    __studioSMatCategories: [categoriesOp, 'List smart-material preset categories'],
  };
  for (const name of Object.keys(ops)) {
    window[name] = ops[name][0];
  }
  registerOps(ops, 'texpaint',
    'Substance Painter smart-material library — 30+ PBR presets (metals/woods/plastics/fabrics/ceramics/stones/glass)');

  return {
    ok: true,
    presets: SMART_PRESETS.length,
    categories: SMART_CATEGORIES.length,
  };
}
