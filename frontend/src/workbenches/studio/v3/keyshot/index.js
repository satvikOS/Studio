// Slice 772 — KeyShot studio environments + render quality presets.
//
// Installs four window ops:
//
//   __studioKSListStudios()          → { ok, studios:[name,...] }
//   __studioKSApplyStudio({name})    → { ok, applied }
//   __studioKSListPresets()          → { ok, presets:[name,...] }
//   __studioKSApplyPreset({name})    → { ok, applied }
//
// Also registers four aliases that match the brief's preferred names:
//
//   __studioKSStudioApply       (alias for ApplyStudio)
//   __studioKSRenderPresetApply (alias for ApplyPreset)
//   __studioKSListEnvironments  (alias for ListStudios)
//   __studioKSListPresets is already canonical.
//
// Applying a studio binds the chosen environment's HDR (chains into
// `__studioHDRApply` when the slice-770 hdrlib is loaded) plus configures
// renderer tone-mapping + exposure + optional 3-point stage lighting +
// optional THREE.Fog. Applying a render preset configures tone-mapping,
// exposure, shadow map type, antialias, and pixel ratio on the active
// THREE.WebGLRenderer; when the preset references a studio environment,
// it chains into applyStudio so a single call configures the entire
// pipeline.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
import {
  STUDIO_ENVIRONMENTS,
  listStudios as listStudioNames,
  getStudio,
  isKnownStudio,
} from './studios.js';
import {
  RENDER_PRESETS,
  listRenderPresets as listRenderPresetNames,
  getRenderPreset,
  isKnownRenderPreset,
} from './renderPresets.js';

let _installed = false;

// Per-module state — last applied identifiers for introspection.
const _state = {
  lastStudio: null,
  lastPreset: null,
};

function _scene() {
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function _renderer() {
  const vp = window.__archdiscViewport;
  return (vp && vp.renderer) || null;
}

function _resolveToneMapping(name) {
  if (!name || typeof name !== 'string') return null;
  if (typeof THREE[name] === 'number') return THREE[name];
  // Fallback for older three builds that don't export AgX/Neutral.
  if (name === 'AgXToneMapping' && typeof THREE.AgXToneMapping !== 'number') {
    return THREE.ACESFilmicToneMapping ?? THREE.LinearToneMapping ?? 1;
  }
  if (name === 'NeutralToneMapping' && typeof THREE.NeutralToneMapping !== 'number') {
    return THREE.ACESFilmicToneMapping ?? THREE.LinearToneMapping ?? 1;
  }
  return null;
}

function _resolveShadowMapType(quality) {
  switch (quality) {
    case 'basic':   return THREE.BasicShadowMap;
    case 'pcf':     return THREE.PCFShadowMap;
    case 'pcfsoft': return THREE.PCFSoftShadowMap;
    case 'vsm':     return THREE.VSMShadowMap;
    default:        return null;
  }
}

function _applyTone(renderer, toneMapping, exposure) {
  if (!renderer) return false;
  const tm = _resolveToneMapping(toneMapping);
  if (tm !== null) renderer.toneMapping = tm;
  if (typeof exposure === 'number' && isFinite(exposure)) {
    renderer.toneMappingExposure = exposure;
  }
  return true;
}

function _wireStageLight(stage) {
  // Wire optional 3-point stage lighting via slice-713 ops if available;
  // otherwise inject our own lights directly into the scene.
  const scene = _scene();
  if (!scene) return;
  if (typeof window.__studioStage3Point === 'function' && (stage.fill || stage.rim || stage.sun)) {
    try {
      window.__studioStage3Point({
        key:  stage.sun,
        fill: stage.fill,
        rim:  stage.rim,
      });
      return;
    } catch (_) { /* fall through */ }
  }
  // Inline fallback — make sure existing keyshot-stage objects are cleared
  // before re-adding so re-apply doesn't accumulate lights.
  const tag = '__archdiscKSStudioLight';
  const toRemove = [];
  scene.traverse((o) => {
    if (o.userData && o.userData[tag]) toRemove.push(o);
  });
  for (const o of toRemove) {
    if (o.parent) o.parent.remove(o);
    if (typeof o.dispose === 'function') o.dispose();
  }
  const _add = (cfg) => {
    if (!cfg) return;
    const L = new THREE.DirectionalLight(cfg.color ?? 0xffffff, cfg.intensity ?? 1.0);
    if (Array.isArray(cfg.position)) L.position.set(...cfg.position);
    L.userData[tag] = true;
    scene.add(L);
  };
  _add(stage.sun);
  _add(stage.fill);
  _add(stage.rim);
}

function _applyFog(scene, fog) {
  if (!scene) return;
  if (!fog) {
    scene.fog = null;
    return;
  }
  const color = fog.color ?? 0x000000;
  const near = typeof fog.near === 'number' ? fog.near : 1;
  const far  = typeof fog.far  === 'number' ? fog.far  : 100;
  scene.fog = new THREE.Fog(color, near, far);
}

// ─── studio apply ───────────────────────────────────────────────────────
export function applyStudio(args) {
  const name = (args && (args.name || args.studioName)) || null;
  if (!name) return { ok: false, error: 'missing-name' };
  if (!isKnownStudio(name)) {
    return { ok: false, error: `unknown-studio: ${name}` };
  }
  const cfg = getStudio(name);
  const renderer = _renderer();
  const scene = _scene();

  // Tone-mapping + exposure.
  _applyTone(renderer, cfg.toneMapping, cfg.exposure);

  // HDR environment — chain through slice-770 hdrlib if present.
  if (cfg.hdr && typeof window.__studioHDRApply === 'function') {
    try {
      window.__studioHDRApply({ envName: cfg.hdr });
    } catch (_) { /* swallow — non-fatal */ }
    if (typeof window.__studioHDRSetIntensity === 'function'
        && typeof cfg.intensity === 'number') {
      try { window.__studioHDRSetIntensity({ intensity: cfg.intensity }); } catch (_) {}
    }
    if (typeof window.__studioHDRSetRotation === 'function'
        && typeof cfg.rotation === 'number') {
      try { window.__studioHDRSetRotation({ angleDeg: cfg.rotation }); } catch (_) {}
    }
  } else if (scene && typeof scene.environmentIntensity !== 'undefined'
             && typeof cfg.intensity === 'number') {
    scene.environmentIntensity = cfg.intensity;
  }

  // Optional fog.
  _applyFog(scene, cfg.fog);

  // Optional 3-point stage lights.
  _wireStageLight({ sun: cfg.sun, fill: cfg.fill, rim: cfg.rim });

  _state.lastStudio = name;
  return { ok: true, applied: name };
}

// ─── render preset apply ────────────────────────────────────────────────
export function applyPreset(args) {
  const name = (args && (args.name || args.presetName)) || null;
  if (!name) return { ok: false, error: 'missing-name' };
  if (!isKnownRenderPreset(name)) {
    return { ok: false, error: `unknown-preset: ${name}` };
  }
  const cfg = getRenderPreset(name);
  const renderer = _renderer();
  const scene = _scene();

  // Tone-mapping + exposure.
  _applyTone(renderer, cfg.toneMapping, cfg.exposure);

  // Shadows.
  if (renderer && cfg.shadowQuality) {
    const t = _resolveShadowMapType(cfg.shadowQuality);
    if (t !== null && renderer.shadowMap) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = t;
      // shadowMap.needsUpdate triggers a recompile of the shadow shader on
      // the next frame so the renderer picks up the new type.
      renderer.shadowMap.needsUpdate = true;
    }
  }

  // Antialias — runtime renderer recreate isn't safe here; we only flip
  // the request so the next renderer-creating slice sees the desired flag.
  if (renderer && typeof cfg.antialias === 'boolean') {
    renderer.userData = renderer.userData || {};
    renderer.userData.archdiscRequestAntialias = cfg.antialias;
  }

  // Pixel ratio.
  if (renderer && typeof cfg.pixelRatio === 'number') {
    const maxDpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 2;
    const clamped = Math.max(0.25, Math.min(cfg.pixelRatio, maxDpr * 2));
    if (typeof renderer.setPixelRatio === 'function') {
      renderer.setPixelRatio(clamped);
    }
  }

  // Background colour from the preset string (only when no environment
  // chain — env apply will replace background with the equirect texture).
  if (scene && cfg.background && !cfg.environment) {
    try { scene.background = new THREE.Color(cfg.background); } catch (_) {}
  }

  // Chain through to a studio environment if requested.
  if (cfg.environment && isKnownStudio(cfg.environment)) {
    applyStudio({ name: cfg.environment });
  }

  _state.lastPreset = name;
  return { ok: true, applied: name };
}

// ─── listing ops ────────────────────────────────────────────────────────
export function listStudios() {
  return { ok: true, studios: listStudioNames() };
}

export function listPresets() {
  return { ok: true, presets: listRenderPresetNames() };
}

export function getCurrent() {
  return {
    ok: true,
    studio: _state.lastStudio,
    preset: _state.lastPreset,
  };
}

// ─── install ────────────────────────────────────────────────────────────
export function installKeyshot() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioKSListStudios:       listStudios,
    __studioKSApplyStudio:       applyStudio,
    __studioKSListPresets:       listPresets,
    __studioKSApplyPreset:       applyPreset,
    // Aliases requested by the slice brief.
    __studioKSStudioApply:       applyStudio,
    __studioKSRenderPresetApply: applyPreset,
    __studioKSListEnvironments:  listStudios,
    // Introspection.
    __studioKSGetCurrent:        getCurrent,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rt',
    'KeyShot studio environments + render presets — 10 studios + 8 quality tiers');
}

// Re-exports for callers that want the catalogues directly.
export { STUDIO_ENVIRONMENTS, RENDER_PRESETS };
