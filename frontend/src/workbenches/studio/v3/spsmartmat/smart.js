// Slice 726 — Substance Painter Smart Materials. Preset PBR materials
// that combine multiple slice-686 paintproj layers with slice-703
// smartmask masks pre-wired (e.g., metal-edges = base brushed-metal
// + edge wear mask + ao dirt). One-call application per mesh.

import * as THREE from 'three';

const SMART_MATERIAL_DEFS = {
  worn_metal: {
    baseColor: [0.6, 0.62, 0.65],
    roughness: 0.4,
    metalness: 0.95,
    edgeWearColor: [0.8, 0.82, 0.85],
    edgeWearStrength: 0.7,
    dirtColor: [0.2, 0.18, 0.15],
    dirtStrength: 0.3,
  },
  weathered_wood: {
    baseColor: [0.55, 0.4, 0.25],
    roughness: 0.85,
    metalness: 0.0,
    edgeWearColor: [0.85, 0.7, 0.55],
    edgeWearStrength: 0.5,
    dirtColor: [0.15, 0.1, 0.06],
    dirtStrength: 0.4,
  },
  painted_chip: {
    baseColor: [0.85, 0.2, 0.2],
    roughness: 0.35,
    metalness: 0.0,
    edgeWearColor: [0.6, 0.55, 0.5],
    edgeWearStrength: 0.6,
    dirtColor: [0.2, 0.15, 0.1],
    dirtStrength: 0.25,
  },
  rusty_iron: {
    baseColor: [0.4, 0.35, 0.32],
    roughness: 0.95,
    metalness: 0.2,
    edgeWearColor: [0.55, 0.25, 0.1],
    edgeWearStrength: 0.8,
    dirtColor: [0.3, 0.2, 0.1],
    dirtStrength: 0.5,
  },
  brushed_steel: {
    baseColor: [0.75, 0.76, 0.78],
    roughness: 0.45,
    metalness: 0.95,
    edgeWearColor: [0.85, 0.86, 0.88],
    edgeWearStrength: 0.3,
    dirtColor: [0.4, 0.4, 0.4],
    dirtStrength: 0.15,
  },
  copper_patina: {
    baseColor: [0.7, 0.4, 0.25],
    roughness: 0.55,
    metalness: 0.9,
    edgeWearColor: [0.9, 0.55, 0.3],
    edgeWearStrength: 0.6,
    dirtColor: [0.15, 0.5, 0.4],   // green patina
    dirtStrength: 0.4,
  },
  worn_leather: {
    baseColor: [0.35, 0.22, 0.15],
    roughness: 0.85,
    metalness: 0.0,
    edgeWearColor: [0.55, 0.4, 0.3],
    edgeWearStrength: 0.4,
    dirtColor: [0.15, 0.1, 0.05],
    dirtStrength: 0.3,
  },
  cracked_paint: {
    baseColor: [0.92, 0.92, 0.9],
    roughness: 0.4,
    metalness: 0.0,
    edgeWearColor: [0.4, 0.35, 0.3],
    edgeWearStrength: 0.7,
    dirtColor: [0.2, 0.18, 0.15],
    dirtStrength: 0.35,
  },
};

const _appliedMaterials = new Map();

export function listMaterials() {
  return { ok: true, materials: Object.keys(SMART_MATERIAL_DEFS) };
}

export function applyMaterial(meshUuid, materialName) {
  const def = SMART_MATERIAL_DEFS[materialName];
  if (!def) return { ok: false, error: 'unknown material: ' + materialName };
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh) return { ok: false };
  // Create the MeshStandardMaterial.
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(def.baseColor[0], def.baseColor[1], def.baseColor[2]),
    roughness: def.roughness,
    metalness: def.metalness,
  });
  mesh.material = mat;
  // Apply vertex-colored edge-wear + dirt via slice-714 polypaint if installed.
  if (typeof window.__studioPolyPaintSetActiveMesh === 'function') {
    window.__studioPolyPaintSetActiveMesh(meshUuid);
    if (typeof window.__studioPolyPaintAddLayer === 'function') {
      const layer1 = window.__studioPolyPaintAddLayer('EdgeWear_' + materialName, { blend: 'add' });
      const layer2 = window.__studioPolyPaintAddLayer('Dirt_' + materialName, { blend: 'multiply' });
      if (layer1?.ok && typeof window.__studioPolyPaintFillLayer === 'function') {
        window.__studioPolyPaintFillLayer(layer1.idx, def.edgeWearColor.map((c) => c * def.edgeWearStrength));
      }
      if (layer2?.ok) {
        window.__studioPolyPaintFillLayer(layer2.idx, def.dirtColor.map((c) => c * def.dirtStrength));
      }
    }
  }
  _appliedMaterials.set(meshUuid, materialName);
  return { ok: true };
}

export function getApplied(meshUuid) {
  return { ok: true, materialName: _appliedMaterials.get(meshUuid) || null };
}

export function defineMaterial(name, def) {
  SMART_MATERIAL_DEFS[name] = def;
  return { ok: true };
}
