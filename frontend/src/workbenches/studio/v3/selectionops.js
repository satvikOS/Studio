// ArchDisc Studio V3 — object-mode selection + pivot family.
//
//   __studioSelectAll       — select every primitive in the scene
//   __studioSelectInverse   — selected → unselected, unselected → selected
//   __studioDeselect        — drop the active selection
//   __studioSelectedMeshes  — current multi-select set
//   __studioSetPivotMode    — median / individual / cursor / origin
//   __studioGetPivotMode    — current pivot mode

const VALID_PIVOTS = new Set(['median', 'individual', 'cursor', 'origin', 'active']);

function scene() {
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}

function _allPrimitives() {
  const s = scene(); if (!s) return [];
  const out = [];
  s.traverse((o) => { if (o.isMesh && o.userData && o.userData.archdiscStudioPrimitive) out.push(o); });
  return out;
}

function _currentSet() {
  // Multi-select set is shared with V2 via window.__studioSelectedMeshesSet.
  // Single-selected mesh contributes if no multi-set is held.
  if (Array.isArray(window.__studioSelectedMeshesSet)) {
    return window.__studioSelectedMeshesSet.slice();
  }
  const vp = window.__archdiscViewport;
  const m = vp && vp.getSelected && vp.getSelected();
  return m ? [m] : [];
}

function selectAll() {
  const set = _allPrimitives();
  window.__studioSelectedMeshesSet = set.slice();
  if (set.length && window.__studioSelectMesh) {
    try { window.__studioSelectMesh(set[set.length - 1]); } catch (_) {}
  }
  return { ok: true, count: set.length };
}

function selectInverse() {
  const all = _allPrimitives();
  const cur = new Set(_currentSet().map((m) => m.uuid));
  const inverse = all.filter((m) => !cur.has(m.uuid));
  window.__studioSelectedMeshesSet = inverse.slice();
  if (!inverse.length) {
    if (window.__studioDeselect) { try { window.__studioDeselect(); } catch (_) {} }
    return { ok: true, count: 0 };
  }
  if (window.__studioSelectMesh) {
    try { window.__studioSelectMesh(inverse[inverse.length - 1]); } catch (_) {}
  }
  return { ok: true, count: inverse.length };
}

function deselect() {
  window.__studioSelectedMeshesSet = [];
  const vp = window.__archdiscViewport;
  if (vp && vp.transformControls && vp.transformControls.object) {
    vp.transformControls.detach();
  }
  return { ok: true };
}

function selectedMeshes() {
  return _currentSet();
}

function setPivotMode(mode) {
  if (!VALID_PIVOTS.has(mode)) return { ok: false, error: 'invalid pivot mode', valid: Array.from(VALID_PIVOTS) };
  window.__studioPivotMode = mode;
  window.dispatchEvent(new CustomEvent('studio-pivot-mode-changed', { detail: { mode } }));
  return { ok: true, mode };
}

function getPivotMode() {
  return window.__studioPivotMode || 'median';
}

export function registerSelectionOps() {
  window.__studioSelectAll      = selectAll;
  window.__studioSelectInverse  = selectInverse;
  window.__studioDeselect       = deselect;
  window.__studioSelectedMeshes = selectedMeshes;
  window.__studioSetPivotMode   = setPivotMode;
  window.__studioGetPivotMode   = getPivotMode;
}

export function unregisterSelectionOps() {
  for (const k of [
    '__studioSelectAll', '__studioSelectInverse', '__studioDeselect',
    '__studioSelectedMeshes', '__studioSetPivotMode', '__studioGetPivotMode',
  ]) { try { delete window[k]; } catch (_) {} }
}
