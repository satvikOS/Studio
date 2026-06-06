// ArchDisc Studio V3 — glTF export polish (slice 768).
//
// Wraps `THREE.GLTFExporter` so the Studio's scene-export path emits the
// glTF 2.0 KHR extensions Studio cares about:
//
//   - KHR_lights_punctual          (any THREE.Light)
//   - KHR_materials_unlit          (MeshBasicMaterial OR userData.unlit)
//   - KHR_materials_clearcoat      (MeshPhysicalMaterial OR userData.clearcoat)
//   - KHR_materials_emissive_strength
//                                  (MeshStandardMaterial w/ emissiveIntensity ≠ 1
//                                   OR userData.emissiveStrength)
//
// Three window ops are registered, all auto-discoverable from the
// command palette under category `interop`:
//
//   __studioGLTFXExport({ sceneUuids?, includeKHR=true })
//     → { ok, json, summary, scene }
//
//   __studioGLTFXListExtensions()
//     → { ok, supported: [...] }
//
//   __studioGLTFXValidate({ json })
//     → { ok, valid, errors: [], warnings: [] }
//
// `__studioGLTFXExport` exports the current scene (or a subset filtered
// by `sceneUuids`) via THREE's GLTFExporter, then runs the KHR injector
// against the resulting JSON. The result is returned as `{ json: <obj>,
// ... }` and `JSON.stringify(json)` is the gltf+json text form. Pure-JS,
// no new deps.

import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { registerOps, unregisterOps } from '../common/registry.js';
import { injectKHRExtensions, SUPPORTED_EXTENSIONS } from './extensions.js';

let _installed = false;

function _scene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

// Build a transient scene that contains:
//   - Every Studio primitive (userData.archdiscStudioPrimitive)
//   - Every Light in the original scene
// If `sceneUuids` is supplied, only objects whose uuid is in the set are
// taken (plus their owning Light when applicable). We clone() so the
// original scene is untouched.
function _buildExportScene(srcScene, sceneUuids) {
  const tempScene = new THREE.Scene();
  if (!srcScene) return tempScene;
  const filterSet = Array.isArray(sceneUuids) && sceneUuids.length
    ? new Set(sceneUuids) : null;
  srcScene.traverse((o) => {
    if (!o) return;
    const isPrim = o.userData && o.userData.archdiscStudioPrimitive;
    const isLight = o.isLight;
    if (!isPrim && !isLight) return;
    if (filterSet && !filterSet.has(o.uuid)) return;
    // Clone copies geometry + material refs + name + userData (deep enough
    // for our extension injector to see the markers we care about).
    const clone = o.clone();
    // Preserve world matrix so the GLTFExporter writes the same
    // translation/rotation/scale.
    if (o.matrixWorld) {
      o.updateMatrixWorld(true);
      o.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    }
    tempScene.add(clone);
  });
  return tempScene;
}

// THREE's GLTFExporter is callback-based; wrap as a Promise.
function _parseAsync(exporter, scene, opts) {
  return new Promise((resolve, reject) => {
    try {
      exporter.parse(
        scene,
        (result) => resolve(result),
        (err) => reject(err),
        opts,
      );
    } catch (err) {
      reject(err);
    }
  });
}

// ──────────────────────────────────────────────────────────────────────
// Ops
// ──────────────────────────────────────────────────────────────────────

async function __studioGLTFXExport(arg) {
  const opts = (arg && typeof arg === 'object') ? arg : {};
  const includeKHR = opts.includeKHR !== false; // default true
  const sceneUuids = Array.isArray(opts.sceneUuids) ? opts.sceneUuids : null;
  const src = _scene();
  if (!src) return { ok: false, error: 'no scene' };
  const tempScene = _buildExportScene(src, sceneUuids);
  const exporter = new GLTFExporter();
  let result;
  try {
    result = await _parseAsync(exporter, tempScene, {
      binary: false,
      onlyVisible: true,
      embedImages: true,
    });
  } catch (err) {
    return { ok: false, error: String((err && err.message) || err) };
  }
  // `result` is a JSON object when binary:false.
  if (!result || typeof result !== 'object') {
    return { ok: false, error: 'gltf exporter returned empty' };
  }
  let summary = null;
  if (includeKHR) {
    const r = injectKHRExtensions(result, tempScene);
    if (r && r.ok) summary = r.summary;
  }
  return {
    ok: true,
    json: result,
    summary,
    scene: { uuid: tempScene.uuid, children: tempScene.children.length },
  };
}

function __studioGLTFXListExtensions() {
  return { ok: true, supported: SUPPORTED_EXTENSIONS.slice() };
}

// Stand-alone validator. Checks structural correctness of the JSON glTF
// 2.0 plus the four supported KHR extensions. Not a spec-complete
// validator — we just flag the issues that matter for Studio's export:
//
//   - Top-level `asset.version` present and starts with "2."
//   - `extensionsUsed` is array of strings (when present)
//   - Every `node.extensions.KHR_lights_punctual.light` points into
//     `extensions.KHR_lights_punctual.lights[]`
//   - Every `KHR_materials_clearcoat.clearcoatFactor` in [0, 1]
//   - Every `KHR_materials_emissive_strength.emissiveStrength` >= 0
//   - Every `KHR_materials_unlit` def is an object (may be empty)
//
// Returns `{ ok, valid, errors, warnings }`. `valid` is true iff
// errors is empty.
function __studioGLTFXValidate(arg) {
  let json = arg && arg.json;
  if (typeof json === 'string') {
    try { json = JSON.parse(json); }
    catch (e) {
      return { ok: false, valid: false, errors: [`invalid JSON: ${String(e)}`], warnings: [] };
    }
  }
  if (!json || typeof json !== 'object') {
    return { ok: false, valid: false, errors: ['no json supplied'], warnings: [] };
  }
  const errors = [];
  const warnings = [];

  if (!json.asset || typeof json.asset !== 'object') {
    errors.push('missing asset block');
  } else if (typeof json.asset.version !== 'string' || !json.asset.version.startsWith('2.')) {
    errors.push(`asset.version must start with "2.", got ${String(json.asset.version)}`);
  }

  if (json.extensionsUsed !== undefined) {
    if (!Array.isArray(json.extensionsUsed)) {
      errors.push('extensionsUsed must be an array');
    } else {
      for (const n of json.extensionsUsed) {
        if (typeof n !== 'string') {
          errors.push(`extensionsUsed contains non-string entry: ${JSON.stringify(n)}`);
        }
      }
    }
  }

  // KHR_lights_punctual.
  const topLights = json.extensions && json.extensions.KHR_lights_punctual;
  if (topLights) {
    if (!Array.isArray(topLights.lights)) {
      errors.push('KHR_lights_punctual.lights must be an array');
    } else {
      for (let i = 0; i < topLights.lights.length; i++) {
        const L = topLights.lights[i];
        if (!L || typeof L !== 'object') {
          errors.push(`KHR_lights_punctual.lights[${i}] must be an object`);
          continue;
        }
        if (!['directional', 'point', 'spot'].includes(L.type)) {
          errors.push(`KHR_lights_punctual.lights[${i}].type must be directional/point/spot, got ${L.type}`);
        }
        if (L.intensity !== undefined && (!Number.isFinite(L.intensity) || L.intensity < 0)) {
          errors.push(`KHR_lights_punctual.lights[${i}].intensity must be a finite >=0 number`);
        }
        if (L.color !== undefined && (!Array.isArray(L.color) || L.color.length !== 3)) {
          errors.push(`KHR_lights_punctual.lights[${i}].color must be a 3-element array`);
        }
      }
    }
  }

  if (Array.isArray(json.nodes)) {
    for (let i = 0; i < json.nodes.length; i++) {
      const n = json.nodes[i];
      const ext = n && n.extensions && n.extensions.KHR_lights_punctual;
      if (ext) {
        if (typeof ext.light !== 'number') {
          errors.push(`nodes[${i}].KHR_lights_punctual.light must be a number`);
          continue;
        }
        const list = topLights && topLights.lights;
        if (!Array.isArray(list) || !list[ext.light]) {
          errors.push(`nodes[${i}].KHR_lights_punctual.light=${ext.light} is out of range`);
        }
      }
    }
  }

  if (Array.isArray(json.materials)) {
    for (let i = 0; i < json.materials.length; i++) {
      const m = json.materials[i];
      const ex = m && m.extensions;
      if (!ex) continue;
      if (ex.KHR_materials_unlit !== undefined && typeof ex.KHR_materials_unlit !== 'object') {
        errors.push(`materials[${i}].KHR_materials_unlit must be an object`);
      }
      if (ex.KHR_materials_clearcoat) {
        const cc = ex.KHR_materials_clearcoat;
        if (typeof cc !== 'object') {
          errors.push(`materials[${i}].KHR_materials_clearcoat must be an object`);
        } else {
          if (cc.clearcoatFactor !== undefined
              && (!Number.isFinite(cc.clearcoatFactor) || cc.clearcoatFactor < 0 || cc.clearcoatFactor > 1)) {
            errors.push(`materials[${i}].KHR_materials_clearcoat.clearcoatFactor must be in [0,1]`);
          }
          if (cc.clearcoatRoughnessFactor !== undefined
              && (!Number.isFinite(cc.clearcoatRoughnessFactor) || cc.clearcoatRoughnessFactor < 0 || cc.clearcoatRoughnessFactor > 1)) {
            errors.push(`materials[${i}].KHR_materials_clearcoat.clearcoatRoughnessFactor must be in [0,1]`);
          }
        }
      }
      if (ex.KHR_materials_emissive_strength) {
        const es = ex.KHR_materials_emissive_strength;
        if (typeof es !== 'object') {
          errors.push(`materials[${i}].KHR_materials_emissive_strength must be an object`);
        } else if (!Number.isFinite(es.emissiveStrength) || es.emissiveStrength < 0) {
          errors.push(`materials[${i}].KHR_materials_emissive_strength.emissiveStrength must be a finite >=0 number`);
        }
      }
    }
  }

  // Warn (but don't fail) if extensionsUsed misses a referenced ext.
  const referencedExts = new Set();
  function _scanForExts(o) {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { for (const v of o) _scanForExts(v); return; }
    for (const k of Object.keys(o)) {
      if (k === 'extensions' && o[k] && typeof o[k] === 'object') {
        for (const en of Object.keys(o[k])) referencedExts.add(en);
      }
      _scanForExts(o[k]);
    }
  }
  _scanForExts(json);
  const used = new Set(Array.isArray(json.extensionsUsed) ? json.extensionsUsed : []);
  for (const e of referencedExts) {
    if (!used.has(e)) {
      warnings.push(`extension ${e} is referenced but not declared in extensionsUsed`);
    }
  }

  return { ok: true, valid: errors.length === 0, errors, warnings };
}

// ──────────────────────────────────────────────────────────────────────
// Install / uninstall
// ──────────────────────────────────────────────────────────────────────

const OP_NAMES = [
  '__studioGLTFXExport',
  '__studioGLTFXListExtensions',
  '__studioGLTFXValidate',
];

export function installGLTFX() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioGLTFXInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioGLTFXInstalled = true;

  const ops = {
    __studioGLTFXExport: [
      __studioGLTFXExport,
      'glTF export — emit JSON with KHR extensions (lights / unlit / clearcoat / emissive)',
    ],
    __studioGLTFXListExtensions: [
      __studioGLTFXListExtensions,
      'glTF export — list KHR extensions supported by the polish wrapper',
    ],
    __studioGLTFXValidate: [
      __studioGLTFXValidate,
      'glTF export — validate a glTF JSON object for structural + KHR correctness',
    ],
  };
  registerOps(ops, 'interop',
    'glTF KHR extension polish — KHR_lights_punctual / KHR_materials_unlit / KHR_materials_clearcoat / KHR_materials_emissive_strength');
  return { ok: true, ops: OP_NAMES.length };
}

export function uninstallGLTFX() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  unregisterOps(OP_NAMES);
  _installed = false;
  window.__studioGLTFXInstalled = false;
  return { ok: true };
}

export {
  __studioGLTFXExport,
  __studioGLTFXListExtensions,
  __studioGLTFXValidate,
  injectKHRExtensions,
  SUPPORTED_EXTENSIONS,
};

export default installGLTFX;
