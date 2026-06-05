// ArchDisc Studio V3 — sculpt layer stack.
//
// A sculpt layer holds a Float32Array of per-vertex POSITION DELTAS
// (x, y, z) on top of a fixed "baseline" position snapshot. Every
// layer has:
//   uuid       — generated once
//   name       — display label
//   strength   — [0..1] multiplier, live editable
//   visible    — boolean; invisible layers contribute nothing
//   delta      — Float32Array(vertCount * 3)
//
// Brush ops are routed via `writeBrushDelta()` so they accumulate
// into the active layer. The composite = baseline + Σ(layer.delta
// × layer.strength × layer.visible). `recomposite()` recomputes
// the mesh position attribute from baseline + every active layer.
//
// Merge-down folds a layer into the layer below it (or into the
// baseline if it's the bottom layer), then drops the source layer.

import * as THREE from 'three';

export const STACK_KEY = 'archdiscStudioSculptLayers';
export const BASE_KEY  = 'archdiscStudioSculptBaseline';
export const ACTIVE_KEY = 'archdiscStudioSculptActiveLayer';

function uuid() {
  // RFC4122-ish; we just need uniqueness within the session.
  return 'sl-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
}

export function ensureStack(mesh) {
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return null;
  mesh.userData = mesh.userData || {};
  const vc = mesh.geometry.attributes.position.count;
  if (!mesh.userData[BASE_KEY] || mesh.userData[BASE_KEY].length !== vc * 3) {
    mesh.userData[BASE_KEY] = new Float32Array(mesh.geometry.attributes.position.array);
  }
  if (!Array.isArray(mesh.userData[STACK_KEY])) {
    mesh.userData[STACK_KEY] = [];
  }
  return mesh.userData[STACK_KEY];
}

export function getStack(mesh) {
  if (!mesh || !mesh.userData) return null;
  const s = mesh.userData[STACK_KEY];
  return Array.isArray(s) ? s : null;
}

export function getActiveLayer(mesh) {
  const stack = getStack(mesh);
  if (!stack || !stack.length) return null;
  const id = mesh.userData[ACTIVE_KEY];
  if (id) {
    const hit = stack.find((l) => l.uuid === id);
    if (hit) return hit;
  }
  // default to topmost
  return stack[stack.length - 1];
}

export function layerAdd(mesh, name) {
  const stack = ensureStack(mesh);
  if (!stack) return { ok: false, error: 'no stack' };
  const vc = mesh.geometry.attributes.position.count;
  const layer = {
    uuid: uuid(),
    name: name || `Layer ${stack.length + 1}`,
    strength: 1,
    visible: true,
    delta: new Float32Array(vc * 3),
  };
  stack.push(layer);
  mesh.userData[ACTIVE_KEY] = layer.uuid;
  return { ok: true, uuid: layer.uuid, name: layer.name, count: stack.length };
}

export function layerList(mesh) {
  const stack = getStack(mesh) || [];
  return {
    ok: true,
    count: stack.length,
    activeUuid: mesh && mesh.userData ? mesh.userData[ACTIVE_KEY] || null : null,
    layers: stack.map((l) => ({
      uuid: l.uuid,
      name: l.name,
      strength: l.strength,
      visible: l.visible,
      verts: l.delta.length / 3,
    })),
  };
}

export function layerSetStrength(mesh, layerUuid, w) {
  const stack = getStack(mesh);
  if (!stack) return { ok: false, error: 'no stack' };
  const l = stack.find((x) => x.uuid === layerUuid);
  if (!l) return { ok: false, error: 'no layer' };
  l.strength = Math.min(1, Math.max(0, Number(w) || 0));
  recomposite(mesh);
  return { ok: true, uuid: l.uuid, strength: l.strength };
}

export function layerToggleVisible(mesh, layerUuid, on) {
  const stack = getStack(mesh);
  if (!stack) return { ok: false, error: 'no stack' };
  const l = stack.find((x) => x.uuid === layerUuid);
  if (!l) return { ok: false, error: 'no layer' };
  l.visible = on == null ? !l.visible : !!on;
  recomposite(mesh);
  return { ok: true, uuid: l.uuid, visible: l.visible };
}

export function layerSetActive(mesh, layerUuid) {
  const stack = getStack(mesh);
  if (!stack) return { ok: false, error: 'no stack' };
  const l = stack.find((x) => x.uuid === layerUuid);
  if (!l) return { ok: false, error: 'no layer' };
  mesh.userData[ACTIVE_KEY] = l.uuid;
  return { ok: true, activeUuid: l.uuid };
}

export function layerDelete(mesh, layerUuid) {
  const stack = getStack(mesh);
  if (!stack) return { ok: false, error: 'no stack' };
  const idx = stack.findIndex((x) => x.uuid === layerUuid);
  if (idx < 0) return { ok: false, error: 'no layer' };
  stack.splice(idx, 1);
  if (mesh.userData[ACTIVE_KEY] === layerUuid) {
    mesh.userData[ACTIVE_KEY] = stack.length ? stack[stack.length - 1].uuid : null;
  }
  recomposite(mesh);
  return { ok: true, removed: layerUuid, remaining: stack.length };
}

// Fold layer `layerUuid` into the layer immediately below it; if it
// is the bottom layer, the delta is baked into the baseline.
export function layerMergeDown(mesh, layerUuid) {
  const stack = getStack(mesh);
  if (!stack) return { ok: false, error: 'no stack' };
  const idx = stack.findIndex((x) => x.uuid === layerUuid);
  if (idx < 0) return { ok: false, error: 'no layer' };
  const src = stack[idx];
  const w = src.visible ? src.strength : 0;
  if (idx === 0) {
    // bake into baseline
    const base = mesh.userData[BASE_KEY];
    for (let i = 0; i < base.length; i++) base[i] += src.delta[i] * w;
    stack.splice(idx, 1);
    if (mesh.userData[ACTIVE_KEY] === layerUuid) {
      mesh.userData[ACTIVE_KEY] = stack.length ? stack[stack.length - 1].uuid : null;
    }
    recomposite(mesh);
    return { ok: true, merged: 'baseline', remaining: stack.length };
  }
  const dst = stack[idx - 1];
  // dst.delta += src.delta * w / dst.strength (so visual result stays
  // identical when dst.strength is non-zero; if dst.strength is 0, we
  // bake at w directly and reset dst.strength to 1).
  if (dst.strength > 0) {
    const k = w / dst.strength;
    for (let i = 0; i < dst.delta.length; i++) dst.delta[i] += src.delta[i] * k;
  } else {
    for (let i = 0; i < dst.delta.length; i++) dst.delta[i] += src.delta[i] * w;
    dst.strength = 1;
  }
  stack.splice(idx, 1);
  if (mesh.userData[ACTIVE_KEY] === layerUuid) {
    mesh.userData[ACTIVE_KEY] = dst.uuid;
  }
  recomposite(mesh);
  return { ok: true, merged: dst.uuid, remaining: stack.length };
}

// Recompute mesh.position.array from baseline + Σ active layer deltas.
export function recomposite(mesh) {
  const stack = getStack(mesh);
  const base = mesh && mesh.userData ? mesh.userData[BASE_KEY] : null;
  if (!stack || !base) return { ok: false };
  const arr = mesh.geometry.attributes.position.array;
  for (let i = 0; i < base.length; i++) arr[i] = base[i];
  for (const l of stack) {
    if (!l.visible || l.strength <= 0) continue;
    const w = l.strength;
    for (let i = 0; i < base.length; i++) arr[i] += l.delta[i] * w;
  }
  mesh.geometry.attributes.position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  return { ok: true };
}

// Brush integration: when the existing brush mutates the mesh position
// directly, record the delta into the active layer instead. Returns
// `true` if there was an active layer to absorb the change.
export function captureBrushDelta(mesh, beforeArray) {
  const stack = getStack(mesh);
  if (!stack || !stack.length) return false;
  const active = getActiveLayer(mesh);
  if (!active) return false;
  const after = mesh.geometry.attributes.position.array;
  for (let i = 0; i < beforeArray.length; i++) {
    const d = after[i] - beforeArray[i];
    if (d !== 0) {
      // Layer delta is in baseline-relative space. If the layer has
      // a non-zero strength, we record the raw delta divided by the
      // strength so the visible effect of the brush matches what
      // the user saw. (If strength==0, fall back to recording raw.)
      const w = active.strength > 0 ? active.strength : 1;
      active.delta[i] += d / w;
    }
  }
  // Don't recomposite here; the brush already updated the mesh array.
  return true;
}

// Snapshot of the *current* mesh position; used by the brush patcher
// before it mutates the array.
export function snapshotPositions(mesh) {
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) return null;
  return new Float32Array(mesh.geometry.attributes.position.array);
}

// Convenience: when DynaMesh remeshes the geometry, the old baseline
// & deltas no longer match the vertex count. Call this to drop them
// and start fresh.
export function resetStack(mesh) {
  if (!mesh || !mesh.userData) return { ok: false };
  delete mesh.userData[STACK_KEY];
  delete mesh.userData[BASE_KEY];
  delete mesh.userData[ACTIVE_KEY];
  return { ok: true };
}

// Tag THREE import so the bundler doesn't tree-shake (the brush
// patcher uses THREE.Vector3).
export const _THREE_REV = THREE.REVISION;
