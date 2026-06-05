// ArchDisc Studio V3 — apply a matlib recipe to the active selection.
//
// applyRecipe(recipeId) upgrades the active mesh's material to
// MeshPhysicalMaterial (preserving the existing colour as a fallback
// when the recipe omits it), then writes every defined parameter from
// the recipe. Returns { ok, id, materialType } or { ok:false, error }.
//
// Pure native — no extra deps, no WASM. Reuses the V3 selection accessor
// pattern: __studioSelectedMesh() first; __archdiscViewport.getSelected
// as fallback so this works even when called before api.js wires up.

import * as THREE from 'three';
import { findRecipe } from './library.js';

function getMesh() {
  if (typeof window === 'undefined') return null;
  if (typeof window.__studioSelectedMesh === 'function') {
    const m = window.__studioSelectedMesh();
    if (m) return m;
  }
  const vp = window.__archdiscViewport;
  return (vp && vp.getSelected && vp.getSelected()) || null;
}

function ensurePhysical(mesh) {
  const old = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  if (old && old.isMeshPhysicalMaterial) return old;
  const oldColor = old && old.color ? old.color.clone() : new THREE.Color(0xeeeeee);
  const next = new THREE.MeshPhysicalMaterial({ color: oldColor });
  // Preserve the existing map if the old material had one (texpaint /
  // shader-graph bake outputs survive a recipe switch).
  if (old && old.map) next.map = old.map;
  if (Array.isArray(mesh.material)) mesh.material[0] = next;
  else mesh.material = next;
  // Dispose the old material last so its map ref-counts don't drop
  // unexpectedly during cross-over.
  if (old && old.dispose && old !== next) old.dispose();
  return next;
}

// Push undo if the V3 undo stack is mounted. No-op otherwise.
function pushUndo() {
  if (typeof window === 'undefined') return;
  if (typeof window.__studioPushUndo === 'function') {
    try { window.__studioPushUndo(); } catch (_) { /* swallow */ }
  }
}

export function writeRecipeParams(mat, params) {
  if (!mat || !params) return;
  if (params.color != null) mat.color.set(params.color);
  if (params.metalness != null) mat.metalness = params.metalness;
  if (params.roughness != null) mat.roughness = params.roughness;
  if (params.clearcoat != null) mat.clearcoat = params.clearcoat;
  // clearcoatRoughness has a sensible default so recipes can omit it.
  if (params.clearcoatRoughness != null) mat.clearcoatRoughness = params.clearcoatRoughness;
  if (params.transmission != null) {
    mat.transmission = params.transmission;
    mat.transparent = params.transmission > 0;
  } else {
    // Recipes without transmission should reset prior translucency so
    // switching from glass → paint actually looks opaque.
    mat.transmission = 0;
    mat.transparent = false;
  }
  if (params.ior != null) mat.ior = params.ior;
  if (params.sheen != null) mat.sheen = params.sheen;
  if (params.sheenColor != null) mat.sheenColor = new THREE.Color(params.sheenColor);
  if (params.sheenRoughness != null) mat.sheenRoughness = params.sheenRoughness;
  if (params.emissive != null) mat.emissive = new THREE.Color(params.emissive);
  else mat.emissive = new THREE.Color(0x000000);
  if (params.emissiveIntensity != null) mat.emissiveIntensity = params.emissiveIntensity;
  else mat.emissiveIntensity = 0;
  if (params.thickness != null) mat.thickness = params.thickness;
  mat.needsUpdate = true;
}

export function applyRecipe(recipeId) {
  const recipe = findRecipe(recipeId);
  if (!recipe) return { ok: false, error: 'unknown recipe', id: recipeId };
  const mesh = getMesh();
  if (!mesh) return { ok: false, error: 'no selection' };
  pushUndo();
  const mat = ensurePhysical(mesh);
  writeRecipeParams(mat, recipe.params);
  mesh.userData = mesh.userData || {};
  mesh.userData.archdiscStudioMatLib = recipe.id;
  return {
    ok: true,
    id: recipe.id,
    name: recipe.name,
    category: recipe.category,
    materialType: mat.type,
  };
}

// Apply a recipe to a specific material instance (e.g. the offscreen
// thumbnail sphere). Exported so the browser can share the writer.
export function applyRecipeToMaterial(mat, recipeId) {
  const recipe = findRecipe(recipeId);
  if (!recipe || !mat) return false;
  writeRecipeParams(mat, recipe.params);
  return true;
}
