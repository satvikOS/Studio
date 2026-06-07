// ArchDisc Studio V3 — slice 892 — volumetric cloud raymarcher.
//
// Sebastian Lague / Horizon Zero Dawn-style REAL volumetric clouds:
//   - 3-octave Perlin + Worley 3D noise for density (noise3D.js)
//   - 64-step ray-march along view ray (raymarch.js)
//   - Beer's law extinction + secondary sun-shadow march for sun visibility
//   - Henyey-Greenstein dual-lobe phase function (silver lining + diffuse)
//   - 6 weather presets (cumulus / cirrus / stratus / storm / fair_weather
//     / overcast) — cloudPresets.js
//
// Ops surface:
//   __studioVCloudsRender({width, height, preset, sunDir, ...}) → {ok, dataUrl}
//   __studioVCloudsListPresets() → {ok, presets}
//   __studioVCloudsConfigure({coverage, height, density}) → {ok, config}
//   __studioVCloudsGetState() → {ok, lastRender, config}

import { registerOps } from '../common/registry.js';
import { renderClouds, pixelsToDataURL, pixelsToDataTexture } from './raymarch.js';
import { CLOUD_PRESETS, CLOUD_PRESET_NAMES, getPreset, listPresets } from './cloudPresets.js';

let _installed = false;

// Persistent per-installer config overrides applied on top of the named
// preset on every render. `Configure` mutates these.
const _config = {
  coverageOverride: null,    // null = use preset's coverage
  heightScale: null,         // null = use preset's [layerBottom, layerTop]
  densityScale: null,        // null = use preset's density
  lastSunDir: null,          // last sun dir used so HUDs can read it
  lastPreset: 'cumulus',
};

let _lastRender = null;       // { width, height, preset, ts }

function _resolvePreset(name) {
  const base = getPreset(name) || getPreset('cumulus');
  if (_config.coverageOverride != null) base.coverage = _config.coverageOverride;
  if (_config.densityScale != null) base.density = base.density * _config.densityScale;
  if (_config.heightScale != null && Array.isArray(_config.heightScale)) {
    const [lo, hi] = _config.heightScale;
    base.cloudLayerBottom = lo;
    base.cloudLayerTop = hi;
  }
  return base;
}

function _opRender(args) {
  const {
    width = 192,
    height = 108,
    preset: presetName = 'cumulus',
    sunDir = { x: -0.35, y: 0.78, z: 0.52 },
    cameraPosition,
    cameraTarget,
    cameraFOV,
    stepCount = 64,
    seed = 1337,
  } = args || {};

  if (!CLOUD_PRESET_NAMES.includes(presetName)) {
    return { ok: false, error: `unknown preset: ${presetName}`, available: CLOUD_PRESET_NAMES.slice() };
  }

  const preset = _resolvePreset(presetName);
  _config.lastPreset = presetName;
  _config.lastSunDir = { ...sunDir };

  const tStart = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  const renderArgs = { width, height, preset, sunDir, stepCount, seed };
  if (cameraPosition) renderArgs.cameraPosition = cameraPosition;
  if (cameraTarget) renderArgs.cameraTarget = cameraTarget;
  if (cameraFOV != null) renderArgs.cameraFOV = cameraFOV;

  const out = renderClouds(renderArgs);
  const tEnd = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

  let dataUrl = null;
  try {
    const r = pixelsToDataURL(out);
    if (r && typeof r === 'string') dataUrl = r;
    // (OffscreenCanvas path returns a Promise; the synchronous op surface
    // skips it. Callers wanting async PNGs can await the same function
    // directly.)
  } catch (_) { /* canvas unavailable in pure Node — ignore */ }

  let textureUuid = null;
  try {
    if (typeof window !== 'undefined' && window.__archdiscScene) {
      const tex = pixelsToDataTexture(out);
      window.__studioVCloudsLastTexture = tex;
      textureUuid = tex.uuid;
    }
  } catch (_) { /* THREE unavailable / scene missing — ignore */ }

  _lastRender = {
    width: out.width,
    height: out.height,
    preset: presetName,
    pixelCount: out.width * out.height,
    elapsedMs: Math.round(tEnd - tStart),
    stepCount,
    seed,
    dataUrlLen: dataUrl ? dataUrl.length : 0,
    textureUuid,
    ts: Date.now(),
  };

  return { ok: true, dataUrl, width: out.width, height: out.height, preset: presetName, elapsedMs: _lastRender.elapsedMs, textureUuid };
}

function _opListPresets() {
  return { ok: true, presets: listPresets() };
}

function _opConfigure(args) {
  const { coverage, height, density } = args || {};
  if (coverage != null) {
    const c = +coverage;
    if (!isFinite(c) || c < 0 || c > 1) return { ok: false, error: 'coverage must be in [0, 1]' };
    _config.coverageOverride = c;
  }
  if (height != null) {
    if (!Array.isArray(height) || height.length !== 2) return { ok: false, error: 'height must be [layerBottom, layerTop]' };
    const [lo, hi] = height;
    if (!(isFinite(lo) && isFinite(hi) && hi > lo)) return { ok: false, error: 'height layerTop must exceed layerBottom' };
    _config.heightScale = [lo, hi];
  }
  if (density != null) {
    const d = +density;
    if (!isFinite(d) || d < 0) return { ok: false, error: 'density must be ≥ 0' };
    _config.densityScale = d;
  }
  return { ok: true, config: { ..._config } };
}

function _opGetState() {
  return {
    ok: true,
    config: { ..._config },
    lastRender: _lastRender ? { ..._lastRender } : null,
    presetCount: CLOUD_PRESET_NAMES.length,
  };
}

function _opApplyToBackground(args) {
  const { preset: presetName = _config.lastPreset, width = 512, height = 256 } = args || {};
  if (typeof window === 'undefined' || !window.__archdiscScene) {
    return { ok: false, error: 'no scene' };
  }
  const r = _opRender({ width, height, preset: presetName });
  if (!r.ok) return r;
  try {
    const scene = window.__archdiscScene;
    const tex = window.__studioVCloudsLastTexture;
    if (tex) {
      scene.background = tex;
      return { ok: true, applied: true, textureUuid: tex.uuid, preset: presetName };
    }
    return { ok: false, error: 'texture build failed' };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export function installVClouds() {
  if (_installed) return { ok: true, already: true };
  _installed = true;

  const ops = {
    __studioVCloudsRender:      _opRender,
    __studioVCloudsListPresets: _opListPresets,
    __studioVCloudsConfigure:   _opConfigure,
    __studioVCloudsGetState:    _opGetState,
    __studioVCloudsApplyToBackground: _opApplyToBackground,
  };

  if (typeof window !== 'undefined') {
    for (const [n, fn] of Object.entries(ops)) {
      window[n] = fn;
    }
  }
  registerOps(ops, 'rt', 'Volumetric clouds — Sebastian Lague / Horizon Zero Dawn-style raymarcher');
  return { ok: true };
}

export default installVClouds;
export { CLOUD_PRESETS, getPreset, listPresets, renderClouds };
