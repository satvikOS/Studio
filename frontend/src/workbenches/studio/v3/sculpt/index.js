// ArchDisc Studio V3 — sculpt depth installer.
//
// `installSculpt()` attaches every op (DynaMesh, mask paint, layer
// stack, alpha brushes) to `window.__studioSculpt*`, registers them
// with the V3 command palette under category 'sculpt', and patches
// the slice 621 brush apply so it respects the mask + active alpha.
//
// Idempotent: re-calling no-ops via window.__studioSculptDepthInstalled.

import { dynaMesh } from './dynamesh.js';
import {
  ensureMask, maskPaint, maskInvert, maskClear,
  maskBlur, maskGrow, maskShrink, getMask,
} from './mask.js';
import {
  ensureStack, layerAdd, layerList, layerSetStrength,
  layerToggleVisible, layerSetActive, layerDelete, layerMergeDown,
  snapshotPositions, captureBrushDelta, getActiveLayer,
} from './layers.js';
import {
  alphaList, alphaSet, alphaSample, alphaWeightAt,
} from './alpha.js';
// Slice 732 — ZBrush Subtools / subtool hierarchy.
import {
  listSubtools, getActiveSubtool, setActiveSubtool, renameSubtool,
  setSubtoolVisible, soloSubtool, appendSubtool, duplicateSubtool,
  deleteSubtool, mergeDownSubtool, mergeVisibleSubtools, moveSubtool,
} from './subtools.js';
import { registerOp } from '../common/registry.js';

function getSelectedMesh() {
  if (typeof window === 'undefined') return null;
  const fn = window.__studioSelectedMesh;
  if (typeof fn !== 'function') return null;
  try { return fn() || null; } catch (_) { return null; }
}

function reg(name, fn, description) {
  registerOp(name, fn, 'sculpt', description);
}

// Build the world-space → mesh-local point given the existing brush
// stroke point is local-space (matching slice 621 contract). Other
// callers passing world coords should call __studioSculptMaskPaint
// with a local-space [x,y,z] too.
function asArr3(p) {
  if (!p) return [0, 0, 0];
  if (Array.isArray(p)) return [Number(p[0]) || 0, Number(p[1]) || 0, Number(p[2]) || 0];
  if (typeof p.x === 'number') return [p.x, p.y || 0, p.z || 0];
  return [0, 0, 0];
}

// Approximate brush-footprint UV: project the vertex's offset from
// the stroke point onto two arbitrary axes orthogonal to the surface
// normal. Good enough for alpha texturing without a full surface
// parameterisation.
function brushUV(dx, dy, dz, size) {
  // Use XZ as a simple planar UV when normal data isn't supplied;
  // tile if outside [0..1].
  const u = (dx / (2 * size)) + 0.5;
  const v = (dz / (2 * size)) + 0.5;
  return [u, v];
}

let _origBrushApply = null;

function patchBrushApply() {
  if (typeof window === 'undefined') return;
  if (window.__studioSculptDepthBrushPatched) return;
  // We want to wrap whatever apply function currently exists. Slice
  // 621 sets window.__studioSculptBrushApply during registerV3Api;
  // we capture & replace.
  const orig = window.__studioSculptBrushApply;
  if (typeof orig !== 'function') {
    // Not installed yet — try once more on next tick.
    setTimeout(patchBrushApply, 0);
    return;
  }
  _origBrushApply = orig;
  window.__studioSculptDepthBrushPatched = true;

  window.__studioSculptBrushApply = function patchedApply(point) {
    const sel = getSelectedMesh();
    if (!sel || !sel.geometry || !sel.geometry.attributes.position) {
      // delegate the error path
      return orig(point);
    }
    const brush = window.__studioSculptBrush || {};
    const size = brush.size || 0.04;
    const p = asArr3(point);

    // Snapshot the pre-stroke position so we can both:
    //   (a) absorb the delta into the active sculpt layer, and
    //   (b) re-weight by mask + alpha after the fact.
    const before = snapshotPositions(sel);
    const result = orig(point);

    if (!result || !result.ok) return result;

    const after = sel.geometry.attributes.position.array;
    const mask = getMask(sel);
    const hasAlpha = !!(window.__studioSculptActiveAlpha && window.__studioSculptActiveAlpha());
    let reweighted = 0;
    if (mask || hasAlpha) {
      // Walk every vertex; we know which were touched by checking
      // before-vs-after deltas. For touched verts, scale the delta
      // by (1 - mask) and by alpha(u,v).
      for (let i = 0; i < before.length; i++) {
        const d = after[i] - before[i];
        if (d === 0) continue;
        const vi = (i / 3) | 0;
        let w = 1;
        if (mask) {
          const m = mask[vi];
          w *= Math.max(0, 1 - m);
        }
        if (hasAlpha) {
          // sample at the vertex offset projected to UV
          const bx = before[vi * 3], by = before[vi * 3 + 1], bz = before[vi * 3 + 2];
          const dx = bx - p[0], dy = by - p[1], dz = bz - p[2];
          const [u, v] = brushUV(dx, dy, dz, size);
          w *= alphaWeightAt(u, v);
        }
        // Re-scale the recorded delta about the baseline value.
        after[i] = before[i] + d * w;
        reweighted++;
      }
      sel.geometry.attributes.position.needsUpdate = true;
      sel.geometry.computeVertexNormals();
      if (sel.geometry.boundsTree) {
        try { sel.geometry.computeBoundsTree(); } catch (_) {}
      }
    }

    // If there's an active sculpt layer, record the (final, post-
    // mask/alpha) delta into it instead of leaving it baked.
    const active = getActiveLayer(sel);
    if (active) {
      captureBrushDelta(sel, before);
    }

    // Return the original result plus any extras.
    return {
      ...result,
      maskApplied: !!mask,
      alphaApplied: hasAlpha,
      layerCaptured: !!active,
      reweighted,
    };
  };
}

const OP_NAMES = [
  '__studioSculptDynaMesh',
  '__studioSculptMaskPaint', '__studioSculptMaskInvert', '__studioSculptMaskClear',
  '__studioSculptMaskBlur',  '__studioSculptMaskGrow',   '__studioSculptMaskShrink',
  '__studioSculptLayerAdd',  '__studioSculptLayerList',  '__studioSculptLayerSetStrength',
  '__studioSculptLayerToggleVisible', '__studioSculptLayerMergeDown',
  '__studioSculptLayerSetActive',     '__studioSculptLayerDelete',
  '__studioSculptAlphaList', '__studioSculptAlphaSet',   '__studioSculptAlphaSample',
  '__studioSculptActiveAlpha',
  // Slice 732 — Subtools.
  '__studioSubtoolList', '__studioSubtoolActive', '__studioSubtoolSetActive',
  '__studioSubtoolRename', '__studioSubtoolSetVisible', '__studioSubtoolSolo',
  '__studioSubtoolAppend', '__studioSubtoolDuplicate', '__studioSubtoolDelete',
  '__studioSubtoolMergeDown', '__studioSubtoolMergeVisible', '__studioSubtoolMove',
];

export function installSculpt() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (window.__studioSculptDepthInstalled) return { ok: true, alreadyInstalled: true };
  window.__studioSculptDepthInstalled = true;

  // ── DynaMesh ────────────────────────────────────────────────────────
  reg('__studioSculptDynaMesh', (resolution) => {
    const sel = getSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    if (window.__studioPushUndo) window.__studioPushUndo('sculpt-dynamesh');
    const r = dynaMesh(sel, resolution == null ? 24 : resolution);
    // Remeshing invalidates the layer stack — wipe it so the next
    // brush stroke starts fresh.
    if (r.ok && sel.userData) {
      delete sel.userData.archdiscStudioSculptLayers;
      delete sel.userData.archdiscStudioSculptBaseline;
      delete sel.userData.archdiscStudioSculptActiveLayer;
      delete sel.userData.archdiscStudioSculptMask;
    }
    return r;
  }, 'Voxel-remesh selected mesh at uniform density (ZBrush DynaMesh).');

  // ── Mask ops ────────────────────────────────────────────────────────
  reg('__studioSculptMaskPaint', (point, radius, strength) => {
    const sel = getSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    return maskPaint(sel, point, radius == null ? 0.05 : radius, strength == null ? 1 : strength);
  }, 'Paint mask at point [x,y,z], radius r, strength s.');

  reg('__studioSculptMaskInvert', () => {
    const sel = getSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    return maskInvert(sel);
  }, 'Invert every vertex mask value (1 - m).');

  reg('__studioSculptMaskClear', () => {
    const sel = getSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    return maskClear(sel);
  }, 'Zero the mask on every vertex.');

  reg('__studioSculptMaskBlur', (iters) => {
    const sel = getSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    return maskBlur(sel, iters == null ? 1 : iters);
  }, 'Laplacian-blur the mask over vertex neighbours.');

  reg('__studioSculptMaskGrow', (radius) => {
    const sel = getSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    return maskGrow(sel, radius == null ? 0.05 : radius);
  }, 'Dilate the mask by a vertex-distance radius.');

  reg('__studioSculptMaskShrink', (radius) => {
    const sel = getSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    return maskShrink(sel, radius == null ? 0.05 : radius);
  }, 'Erode the mask by a vertex-distance radius.');

  // ── Layer stack ─────────────────────────────────────────────────────
  reg('__studioSculptLayerAdd', (name) => {
    const sel = getSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    ensureStack(sel);
    return layerAdd(sel, name);
  }, 'Add a sculpt layer (per-vertex position delta).');

  reg('__studioSculptLayerList', () => {
    const sel = getSelectedMesh();
    if (!sel) return { ok: true, count: 0, layers: [] };
    return layerList(sel);
  }, 'List the sculpt layer stack with strength + visibility.');

  reg('__studioSculptLayerSetStrength', (uuid, w) => {
    const sel = getSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    return layerSetStrength(sel, uuid, w);
  }, 'Set a sculpt layer\'s strength [0..1].');

  reg('__studioSculptLayerToggleVisible', (uuid, on) => {
    const sel = getSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    return layerToggleVisible(sel, uuid, on);
  }, 'Toggle a sculpt layer\'s visibility.');

  reg('__studioSculptLayerMergeDown', (uuid) => {
    const sel = getSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    return layerMergeDown(sel, uuid);
  }, 'Merge a sculpt layer into the layer below it (or the baseline).');

  reg('__studioSculptLayerSetActive', (uuid) => {
    const sel = getSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    return layerSetActive(sel, uuid);
  }, 'Set which sculpt layer the next brush stroke writes into.');

  reg('__studioSculptLayerDelete', (uuid) => {
    const sel = getSelectedMesh();
    if (!sel) return { ok: false, error: 'no selection' };
    return layerDelete(sel, uuid);
  }, 'Delete a sculpt layer from the stack.');

  // ── Alphas ──────────────────────────────────────────────────────────
  reg('__studioSculptAlphaList', () => alphaList(),
    'List all available procedural alpha brushes.');
  reg('__studioSculptAlphaSet', (name) => alphaSet(name),
    'Activate an alpha brush by name (or clear with null).');
  reg('__studioSculptAlphaSample', (u, v) => alphaSample(Number(u) || 0, Number(v) || 0),
    'Sample the active alpha at fractional UV (bilinear).');
  reg('__studioSculptActiveAlpha', () => (alphaList().active || null),
    'Return the active alpha brush name (or null).');

  // ── Subtools (slice 732) — ZBrush SubTool hierarchy ─────────────────
  reg('__studioSubtoolList', () => listSubtools(),
    'List all subtools (active/visible/solo/triangles) — ZBrush SubTool palette.');
  reg('__studioSubtoolActive', () => getActiveSubtool(),
    'Return the active subtool (and select its mesh).');
  reg('__studioSubtoolSetActive', (idxOrUuid) => setActiveSubtool(idxOrUuid),
    'Make a subtool active by index or uuid (ZBrush: click a SubTool).');
  reg('__studioSubtoolRename', (idxOrUuid, name) => renameSubtool(idxOrUuid, name),
    'Rename a subtool.');
  reg('__studioSubtoolSetVisible', (idxOrUuid, on) => setSubtoolVisible(idxOrUuid, on),
    'Show/hide a subtool (the eye toggle).');
  reg('__studioSubtoolSolo', (idxOrUuid) => soloSubtool(idxOrUuid),
    'Solo a subtool (hide all others); pass null to clear solo.');
  reg('__studioSubtoolAppend', (kind, name) => appendSubtool(kind, name),
    'Append a new subtool (fresh primitive) — ZBrush SubTool > Append.');
  reg('__studioSubtoolDuplicate', (idxOrUuid) => duplicateSubtool(idxOrUuid),
    'Duplicate a subtool (geometry + transform) — SubTool > Duplicate.');
  reg('__studioSubtoolDelete', (idxOrUuid) => deleteSubtool(idxOrUuid),
    'Delete a subtool — SubTool > Delete.');
  reg('__studioSubtoolMergeDown', (idxOrUuid) => mergeDownSubtool(idxOrUuid),
    'Merge a subtool down into the one below it — SubTool > Merge Down.');
  reg('__studioSubtoolMergeVisible', () => mergeVisibleSubtools(),
    'Merge every visible subtool into one mesh — SubTool > Merge Visible.');
  reg('__studioSubtoolMove', (idxOrUuid, delta) => moveSubtool(idxOrUuid, delta),
    'Reorder a subtool up (-1) or down (+1) in the list.');

  // ── Brush patch ─────────────────────────────────────────────────────
  // The slice 621 brush apply is registered during registerV3Api.
  // Patch it now (immediately if it's there, else on next macrotask).
  patchBrushApply();

  return { ok: true, alreadyInstalled: false, ops: OP_NAMES.length };
}

export function uninstallSculpt() {
  if (typeof window === 'undefined') return { ok: false };
  if (!window.__studioSculptDepthInstalled) return { ok: true };
  for (const k of OP_NAMES) {
    try { delete window[k]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(k); } catch (_) {}
    }
  }
  // Restore original brush apply if we patched it.
  if (window.__studioSculptDepthBrushPatched && _origBrushApply) {
    window.__studioSculptBrushApply = _origBrushApply;
    window.__studioSculptDepthBrushPatched = false;
    _origBrushApply = null;
  }
  window.__studioSculptDepthInstalled = false;
  return { ok: true };
}
