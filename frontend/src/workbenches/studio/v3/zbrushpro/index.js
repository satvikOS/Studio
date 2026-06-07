// ArchDisc Studio V3 — ZBrush Pro 50+ brush catalogue installer (slice 782).
//
// installZBrushPro() wires four window-level ops that turn the 50+ named
// brushes in `brushCatalog.js` into a usable surface:
//
//   __studioZBrushProListBrushes()
//     → { ok, names: ['Clay', 'Standard', 'DamStandard', …] }
//
//   __studioZBrushProApplyBrush({ meshUuid, name, center, radius, strength })
//     → { ok, changedVerts, brush, baseKernel, blend }
//     Apply a named brush by resolving its catalogue entry, then
//     delegating to slice 758's `__studioZBrushBrush` op for the base
//     kernel and any blend kernel — so undo, falloff curves, BVH refresh
//     and the neighbour cache are all reused.
//
//   __studioZBrushProGetBrushDetails({ name })
//     → { ok, name, baseKernel, params, falloff, description, category }
//
//   __studioZBrushProCategories()
//     → { ok, categories: ['sculpt', 'mask', 'curve', 'insert', …] }
//
// Idempotent: re-invoking returns { alreadyInstalled: true }. Ops
// register under category 'sculpt' so they live in the same palette
// grouping as zbrushdetail/sculptbrushes.

import {
  ZBRUSH_PRO_CATALOG,
  ZBRUSH_PRO_CATEGORIES,
  getBrushEntry,
  listBrushNames,
  listCategories,
} from './brushCatalog.js';
import { registerOps, unregisterOps } from '../common/registry.js';

let _installed = false;

// Resolve the seven kernel names slice 758 supports.
const SLICE_758_KERNELS = ['draw', 'inflate', 'crease', 'pinch', 'flatten', 'grab', 'smooth'];

// `mask` is a "kernel" we expose at the catalogue level but the actual
// slice-758 op only ships sculpt kernels. We fall back to the legacy
// `__studioSculptMaskPaint` global the mask path uses elsewhere in the
// codebase (slice 151 onward) so mask brushes still do real work.

// ─── helpers ──────────────────────────────────────────────────────────

function _hasSlice758() {
  return typeof window !== 'undefined'
    && typeof window.__studioZBrushBrush === 'function';
}

function _hasMaskPaint() {
  return typeof window !== 'undefined'
    && typeof window.__studioSculptMaskPaint === 'function';
}

// Resolve a mesh by uuid; falls back to active selection like slice 758.
function _resolveMesh(meshUuid) {
  if (typeof window === 'undefined') return null;
  if (meshUuid) {
    const scene = window.__archdiscScene;
    if (scene && typeof scene.getObjectByProperty === 'function') {
      const m = scene.getObjectByProperty('uuid', meshUuid);
      if (m) return m;
    }
    if (scene && typeof scene.traverse === 'function') {
      let found = null;
      scene.traverse((o) => { if (!found && o && o.uuid === meshUuid) found = o; });
      if (found) return found;
    }
  }
  if (typeof window.__studioSelectedMesh === 'function') {
    return window.__studioSelectedMesh() || null;
  }
  return null;
}

// Build the per-pass params slice 758's op expects:
//   { center, radius, strength, curve, motion? }
// from the user's call args + the catalogue entry.
function _buildKernelParams(entry, userParams, kernelOverride) {
  const params = {};
  const p = entry.params || {};
  // Center / radius pass straight through.
  params.center = Array.isArray(userParams.center) ? userParams.center.slice() : [0, 0, 0];
  params.radius = +userParams.radius || 0.1;

  // Strength = user × catalogue scale × (invert?).
  const baseStrength = (typeof userParams.strength === 'number') ? userParams.strength : 0.5;
  let s = baseStrength * (typeof p.strengthScale === 'number' ? p.strengthScale : 1.0);
  if (p.invert) s = -s;

  // Sharpness: raise strength to the n-th power (preserving sign) and
  // multiply by a small sharpening boost so n=1 is identity.
  if (typeof p.sharpness === 'number' && p.sharpness > 1) {
    const sign = s < 0 ? -1 : 1;
    s = sign * Math.pow(Math.abs(s), 1 / p.sharpness) * 1.0;
  }

  // Blend kernel runs at strength * weight (catalogued).
  if (kernelOverride && kernelOverride.weightOverride != null) {
    s = baseStrength * (kernelOverride.weightOverride);
    if (p.invert) s = -s;
  }
  params.strength = s;

  // Falloff curve: pass per-brush entry. Slice 758 reads `params.curve`
  // and falls back to the active curve when omitted.
  if (entry.falloff) params.curve = entry.falloff;

  // Grab-flavoured kernels need a motion vector. Use userParams.motion
  // if provided; otherwise synthesise an along-Y delta scaled by radius.
  if (userParams.motion) {
    params.motion = Array.isArray(userParams.motion) ? userParams.motion.slice() : [0, 0, 0];
  } else if (kernelOverride && kernelOverride.kernel === 'grab') {
    // Provide a sane default so Move/Stretch/SnakeHook still do work.
    const r = params.radius;
    params.motion = [0, r * 0.5 * (p.invert ? -1 : 1), 0];
  }

  return params;
}

// Apply a single kernel pass via slice 758's op. Returns the change
// count from the op (0 on failure).
function _applyKernelPass(kernel, meshUuid, params) {
  if (!_hasSlice758()) return { ok: false, changed: 0, error: 'slice 758 zbrushdetail not installed' };
  if (!SLICE_758_KERNELS.includes(kernel)) {
    return { ok: false, changed: 0, error: 'unknown kernel ' + kernel };
  }
  try {
    const r = window.__studioZBrushBrush(meshUuid, kernel, params);
    if (!r) return { ok: false, changed: 0, error: 'no response from slice 758' };
    return { ok: !!r.ok, changed: +r.changed || 0, raw: r };
  } catch (e) {
    return { ok: false, changed: 0, error: String(e && e.message || e) };
  }
}

// Mask-kernel fallback for the mask family. Uses slice 151's mask paint
// op when present; otherwise reports zero changed and ok=true (the mask
// path doesn't mutate geometry).
function _applyMaskPass(entry, userParams) {
  if (!_hasMaskPaint()) {
    return { ok: false, changed: 0, error: 'mask paint not available' };
  }
  try {
    const center = Array.isArray(userParams.center) ? userParams.center : [0, 0, 0];
    const radius = +userParams.radius || 0.1;
    const strength = (typeof userParams.strength === 'number') ? userParams.strength : 0.5;
    const r = window.__studioSculptMaskPaint(center, radius, strength);
    return {
      ok: !!(r && r.ok),
      changed: (r && (r.painted || r.touched)) || 0,
      raw: r,
    };
  } catch (e) {
    return { ok: false, changed: 0, error: String(e && e.message || e) };
  }
}

// ─── ops ──────────────────────────────────────────────────────────────

// __studioZBrushProListBrushes() → { ok, names: [...] }
function opListBrushes() {
  return {
    ok: true,
    count: ZBRUSH_PRO_CATALOG.length,
    names: listBrushNames(),
  };
}

// __studioZBrushProGetBrushDetails({ name }) → { ok, … }
function opGetBrushDetails(args) {
  const name = args && args.name ? String(args.name) : '';
  const e = getBrushEntry(name);
  if (!e) {
    return { ok: false, error: 'unknown brush', name, valid: listBrushNames() };
  }
  return {
    ok: true,
    name: e.name,
    baseKernel: e.baseKernel,
    params: Object.assign({}, e.params),
    falloff: e.falloff,
    description: e.description,
    category: e.category,
  };
}

// __studioZBrushProCategories() → { ok, categories: [...] }
function opCategories() {
  return {
    ok: true,
    categories: listCategories(),
    all: ZBRUSH_PRO_CATEGORIES.slice(),
  };
}

// __studioZBrushProApplyBrush({ meshUuid, name, center, radius, strength, motion }) → { ok, changedVerts }
function opApplyBrush(args) {
  if (!args || typeof args !== 'object') {
    return { ok: false, error: 'args required' };
  }
  const name = args.name ? String(args.name) : '';
  const entry = getBrushEntry(name);
  if (!entry) {
    return { ok: false, error: 'unknown brush', name, valid: listBrushNames() };
  }

  const meshUuid = args.meshUuid ? String(args.meshUuid) : null;
  const mesh = _resolveMesh(meshUuid);
  if (!mesh) {
    return { ok: false, error: 'mesh not found', meshUuid };
  }
  // Real uuid (in case the caller passed null and we picked active sel.).
  const resolvedUuid = mesh.uuid;

  // Build the per-pass params from the catalogue entry + user call.
  const userParams = {
    center: args.center,
    radius: args.radius,
    strength: args.strength,
    motion: args.motion,
  };

  // Primary pass.
  let totalChanged = 0;
  let primary;
  if (entry.baseKernel === 'mask') {
    primary = _applyMaskPass(entry, userParams);
  } else {
    const primParams = _buildKernelParams(entry, userParams, { kernel: entry.baseKernel });
    primary = _applyKernelPass(entry.baseKernel, resolvedUuid, primParams);
  }
  if (!primary.ok) {
    return {
      ok: false,
      error: primary.error || 'primary pass failed',
      brush: entry.name,
      baseKernel: entry.baseKernel,
      meshUuid: resolvedUuid,
    };
  }
  totalChanged += primary.changed;

  // Blend pass (composite brushes — Clay / ClayBuildup / Polish / …).
  let blend = null;
  if (Array.isArray(entry.params && entry.params.blend)) {
    const [blendKernel, blendWeight] = entry.params.blend;
    if (SLICE_758_KERNELS.includes(blendKernel)) {
      const blendParams = _buildKernelParams(entry, userParams, {
        kernel: blendKernel,
        weightOverride: blendWeight,
      });
      const blendR = _applyKernelPass(blendKernel, resolvedUuid, blendParams);
      blend = { kernel: blendKernel, weight: blendWeight, changed: blendR.changed };
      totalChanged += blendR.changed;
    }
  }

  return {
    ok: true,
    brush: entry.name,
    baseKernel: entry.baseKernel,
    falloff: entry.falloff,
    category: entry.category,
    meshUuid: resolvedUuid,
    changedVerts: totalChanged,
    primaryChanged: primary.changed,
    blend,
  };
}

const OP_NAMES = [
  '__studioZBrushProListBrushes',
  '__studioZBrushProApplyBrush',
  '__studioZBrushProGetBrushDetails',
  '__studioZBrushProCategories',
];

export function installZBrushPro() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed) return { ok: true, alreadyInstalled: true };
  _installed = true;

  registerOps({
    __studioZBrushProListBrushes: [opListBrushes,
      'ZBrush Pro: list all 50+ named brushes in the catalogue (slice 782).'],
    __studioZBrushProApplyBrush: [opApplyBrush,
      'ZBrush Pro: apply a named brush ({meshUuid,name,center,radius,strength}) — delegates to slice 758 kernels.'],
    __studioZBrushProGetBrushDetails: [opGetBrushDetails,
      'ZBrush Pro: details for one named brush ({name} → baseKernel/params/falloff/description/category).'],
    __studioZBrushProCategories: [opCategories,
      'ZBrush Pro: list brush categories present in the catalogue (sculpt/mask/curve/insert/topology/project/utility).'],
  }, 'sculpt');

  return {
    ok: true,
    alreadyInstalled: false,
    ops: OP_NAMES.length,
    brushes: ZBRUSH_PRO_CATALOG.length,
    categories: listCategories().length,
  };
}

export function uninstallZBrushPro() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  unregisterOps(OP_NAMES);
  _installed = false;
  return { ok: true };
}

export default installZBrushPro;
