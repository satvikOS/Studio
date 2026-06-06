// ArchDisc Studio V3 — Substance Painter smart-material apply pipeline
// (slice 769).
//
// `applySmartMaterial(mesh, presetName)` swaps `mesh.material` to a
// fresh THREE.MeshStandardMaterial for the simple case OR a
// MeshPhysicalMaterial when the preset asks for `ior`, `clearcoat`, or
// `transmission` (the three params standard Lambert/GGX can't drive).
//
// Returns `{ ok, applied:{name,category}, materialType, params }`.
// Returns `{ ok:false, error }` if either argument is missing/invalid.
//
// Pure native — no deps beyond three. Reuses the dispose-on-swap pattern
// the matlib uses so old materials don't leak GPU memory.

import * as THREE from 'three';
import { findPreset } from './presets.js';

// Helper: a preset needs MeshPhysicalMaterial if it sets at least one
// of the physical-only lobes / refraction params.
function needsPhysical(p) {
  if (!p) return false;
  if (p.ior != null) return true;
  if (p.clearcoat != null && p.clearcoat > 0) return true;
  if (p.transmission != null && p.transmission > 0) return true;
  return false;
}

function makeMaterial(preset) {
  const baseColor = preset.baseColor != null ? preset.baseColor : 0xffffff;
  const opts = {
    color: new THREE.Color(baseColor),
    roughness: typeof preset.roughness === 'number' ? preset.roughness : 0.5,
    metalness: typeof preset.metalness === 'number' ? preset.metalness : 0.0,
  };
  if (preset.emissive != null) opts.emissive = new THREE.Color(preset.emissive);

  if (needsPhysical(preset)) {
    const mat = new THREE.MeshPhysicalMaterial(opts);
    if (preset.ior != null) mat.ior = preset.ior;
    if (preset.clearcoat != null) {
      mat.clearcoat = preset.clearcoat;
      // A typical Substance clearcoat is mirror-smooth.
      mat.clearcoatRoughness = preset.clearcoatRoughness != null
        ? preset.clearcoatRoughness : 0.05;
    }
    if (preset.transmission != null) {
      mat.transmission = preset.transmission;
      mat.transparent = preset.transmission > 0;
    }
    if (preset.normalScale != null) {
      mat.normalScale = new THREE.Vector2(preset.normalScale, preset.normalScale);
    }
    return mat;
  }

  const mat = new THREE.MeshStandardMaterial(opts);
  if (preset.normalScale != null) {
    mat.normalScale = new THREE.Vector2(preset.normalScale, preset.normalScale);
  }
  return mat;
}

// Public: swap a mesh's material to one driven by the named preset.
// `mesh` is either a THREE.Mesh or a uuid string (lookup via the live
// scene). The string path keeps the op surface JSON-friendly across the
// renderer/worker boundary.
export function applySmartMaterial(mesh, presetName) {
  if (!presetName) return { ok: false, error: 'missing preset name' };
  const preset = findPreset(presetName);
  if (!preset) return { ok: false, error: `unknown preset: ${presetName}` };

  // Resolve uuid → mesh if needed.
  let resolved = mesh;
  if (typeof mesh === 'string' && typeof window !== 'undefined') {
    const scene = window.__archdiscScene;
    if (!scene) return { ok: false, error: 'no scene' };
    resolved = scene.getObjectByProperty('uuid', mesh) || null;
  }
  if (!resolved || !resolved.isObject3D) {
    return { ok: false, error: 'mesh not found' };
  }
  if (!resolved.isMesh) {
    return { ok: false, error: 'target is not a Mesh' };
  }

  const next = makeMaterial(preset);

  // Preserve the existing map if any — texpaint / shader-graph bakes
  // shouldn't be lost on a preset swap (matches matlib behaviour).
  const old = Array.isArray(resolved.material) ? resolved.material[0] : resolved.material;
  if (old && old.map) next.map = old.map;
  if (Array.isArray(resolved.material)) resolved.material[0] = next;
  else resolved.material = next;
  if (old && old.dispose && old !== next) {
    try { old.dispose(); } catch (_) { /* swallow */ }
  }

  resolved.userData = resolved.userData || {};
  resolved.userData.archdiscStudioSmartMat = preset.name;

  return {
    ok: true,
    applied: { name: preset.name, category: preset.category },
    materialType: next.type,
    params: {
      baseColor: preset.baseColor,
      roughness: preset.roughness,
      metalness: preset.metalness,
      ior: preset.ior,
      clearcoat: preset.clearcoat,
      transmission: preset.transmission,
      normalScale: preset.normalScale,
      emissive: preset.emissive,
    },
  };
}

// Same surface as the matlib helper — exposed so the preview op can
// share the param projection without re-implementing it.
export function previewSmartMaterial(presetName) {
  const preset = findPreset(presetName);
  if (!preset) return { ok: false, error: `unknown preset: ${presetName}` };
  return {
    ok: true,
    values: {
      name: preset.name,
      category: preset.category,
      baseColor: preset.baseColor,
      color: preset.color,
      roughness: preset.roughness,
      metalness: preset.metalness,
      ior: preset.ior,
      clearcoat: preset.clearcoat,
      normalScale: preset.normalScale,
      emissive: preset.emissive,
      transmission: preset.transmission,
    },
    materialType: needsPhysical(preset) ? 'MeshPhysicalMaterial' : 'MeshStandardMaterial',
  };
}
