// Slice 770 — HDRI environment library install + ops.
//
// Wires five window ops:
//
//   __studioHDRListEnvs()                       → { ok, envs:[...] }
//   __studioHDRApply({envName})                 → { ok, applied }
//   __studioHDRSetIntensity({intensity})        → { ok }
//   __studioHDRSetRotation({angleDeg})          → { ok }
//   __studioHDRLoadCustom({url})                → { ok, applied }
//
// The 20 procedural envs are synthesised in `proceduralHDR.js`. Custom .hdr
// URLs are loaded via THREE.RGBELoader (the canonical Radiance HDR loader
// shipped with three.js — same one the existing `v3/hdri/ibl.js` uses).
//
// The applied texture is run through THREE.PMREMGenerator before assignment
// to scene.environment so the rendered reflection matches the procedural
// gradient + sun discs (otherwise raw equirect doesn't blur correctly across
// PBR roughness levels).

import * as THREE from 'three';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';
import { registerOps } from '../common/registry.js';
import {
  generateProceduralHDR,
  listProceduralEnvs,
  isKnownEnv,
} from './proceduralHDR.js';

let _installed = false;

// Per-module state.
const _state = {
  currentEnvName: null,    // last applied procedural name, or null
  currentEnvTexture: null, // raw DataTexture or CanvasTexture (not PMREM'd)
  currentEnvMap: null,     // PMREM cube texture actually bound on scene
  intensity: 1.0,
  rotationDeg: 0,
  pmremGen: null,
};

function _scene() {
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function _pmrem() {
  if (_state.pmremGen) return _state.pmremGen;
  const r = window.__archdiscViewport && window.__archdiscViewport.renderer;
  if (!r) return null;
  _state.pmremGen = new THREE.PMREMGenerator(r);
  return _state.pmremGen;
}

function _disposeCurrent() {
  if (_state.currentEnvMap && _state.currentEnvMap.dispose) {
    _state.currentEnvMap.dispose();
  }
  if (_state.currentEnvTexture && _state.currentEnvTexture.dispose) {
    _state.currentEnvTexture.dispose();
  }
  _state.currentEnvMap = null;
  _state.currentEnvTexture = null;
}

function _applyTexture(tex, name) {
  const scene = _scene();
  if (!scene) return { ok: false, error: 'no-scene' };
  _disposeCurrent();
  _state.currentEnvTexture = tex;
  _state.currentEnvName = name;

  // Try PMREM (gives correct PBR specular blur). Fall back to the raw
  // equirect texture if no renderer is available (e.g. very early boot).
  const pmrem = _pmrem();
  let bound = tex;
  if (pmrem) {
    try {
      const out = pmrem.fromEquirectangular(tex).texture;
      _state.currentEnvMap = out;
      bound = out;
    } catch (_) { /* fall through to raw */ }
  }
  scene.environment = bound;
  scene.background = bound;
  if (typeof scene.environmentIntensity !== 'undefined') {
    scene.environmentIntensity = _state.intensity;
  }
  if (typeof scene.backgroundIntensity !== 'undefined') {
    scene.backgroundIntensity = _state.intensity;
  }
  const radians = _state.rotationDeg * Math.PI / 180;
  if (typeof scene.environmentRotation !== 'undefined') {
    if (scene.environmentRotation && typeof scene.environmentRotation.set === 'function') {
      scene.environmentRotation.set(0, radians, 0);
    } else {
      scene.environmentRotation = new THREE.Euler(0, radians, 0);
    }
  }
  if (typeof scene.backgroundRotation !== 'undefined') {
    if (scene.backgroundRotation && typeof scene.backgroundRotation.set === 'function') {
      scene.backgroundRotation.set(0, radians, 0);
    } else {
      scene.backgroundRotation = new THREE.Euler(0, radians, 0);
    }
  }
  return { ok: true, applied: name };
}

// ─── ops ────────────────────────────────────────────────────────────────
export function listEnvs() {
  return { ok: true, envs: listProceduralEnvs() };
}

export function applyEnv(args) {
  const envName = (args && args.envName) || null;
  if (!envName) return { ok: false, error: 'missing-envName' };
  if (!isKnownEnv(envName)) {
    return { ok: false, error: `unknown-env: ${envName}` };
  }
  const tex = generateProceduralHDR(envName);
  if (!tex) return { ok: false, error: 'gen-failed' };
  return _applyTexture(tex, envName);
}

export function setIntensity(args) {
  const v = args && args.intensity;
  if (typeof v !== 'number' || !isFinite(v)) {
    return { ok: false, error: 'bad-intensity' };
  }
  _state.intensity = Math.max(0, v);
  const scene = _scene();
  if (scene) {
    if (typeof scene.environmentIntensity !== 'undefined') {
      scene.environmentIntensity = _state.intensity;
    }
    if (typeof scene.backgroundIntensity !== 'undefined') {
      scene.backgroundIntensity = _state.intensity;
    }
  }
  return { ok: true, intensity: _state.intensity };
}

export function setRotation(args) {
  const angleDeg = args && args.angleDeg;
  if (typeof angleDeg !== 'number' || !isFinite(angleDeg)) {
    return { ok: false, error: 'bad-angle' };
  }
  _state.rotationDeg = angleDeg;
  const radians = angleDeg * Math.PI / 180;
  const scene = _scene();
  if (scene) {
    if (typeof scene.environmentRotation !== 'undefined') {
      if (scene.environmentRotation && typeof scene.environmentRotation.set === 'function') {
        scene.environmentRotation.set(0, radians, 0);
      } else {
        scene.environmentRotation = new THREE.Euler(0, radians, 0);
      }
    }
    if (typeof scene.backgroundRotation !== 'undefined') {
      if (scene.backgroundRotation && typeof scene.backgroundRotation.set === 'function') {
        scene.backgroundRotation.set(0, radians, 0);
      } else {
        scene.backgroundRotation = new THREE.Euler(0, radians, 0);
      }
    }
  }
  return { ok: true, angleDeg };
}

export function loadCustom(args) {
  const url = args && args.url;
  if (!url || typeof url !== 'string') {
    return Promise.resolve({ ok: false, error: 'missing-url' });
  }
  return new Promise((resolve) => {
    const loader = new RGBELoader();
    loader.setDataType(THREE.FloatType);
    loader.load(url,
      (texture) => {
        texture.mapping = THREE.EquirectangularReflectionMapping;
        texture.userData.archdiscStudioHDRLibCustomURL = url;
        const r = _applyTexture(texture, `custom:${url}`);
        resolve(r);
      },
      undefined,
      (err) => {
        resolve({ ok: false, error: err && err.message ? err.message : String(err) });
      },
    );
  });
}

export function getCurrent() {
  return {
    ok: true,
    name: _state.currentEnvName,
    intensity: _state.intensity,
    rotationDeg: _state.rotationDeg,
    bound: !!_state.currentEnvMap || !!_state.currentEnvTexture,
  };
}

export function installHDRLib() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioHDRListEnvs: listEnvs,
    __studioHDRApply: applyEnv,
    __studioHDRSetIntensity: setIntensity,
    __studioHDRSetRotation: setRotation,
    __studioHDRLoadCustom: loadCustom,
    __studioHDRGetCurrent: getCurrent,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rt',
    'HDRI environment library — 20 procedural presets + real .hdr URL loading');
}
