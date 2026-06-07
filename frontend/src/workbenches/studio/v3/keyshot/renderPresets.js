// Slice 772 — KeyShot render quality presets.
//
// 8 quality presets keyed by name. Each entry describes a renderer
// configuration: tone-mapping mode (string keyed to `THREE.*ToneMapping`),
// exposure (renderer.toneMappingExposure), shadowQuality (mapped to
// THREE.PCFSoftShadowMap / VSMShadowMap / BasicShadowMap), antialias flag
// (forwarded into the WebGLRenderer recreate path when supported), and
// pixelRatio (clamped against window.devicePixelRatio at apply-time).
//
// `sampleCount` is a hint used by the path-tracer (slice 766 `rtgpu`) +
// the SLuminance accumulator (slice 504 `lumen`); irrelevant for the raster
// path but exposed so callers can introspect intended quality tier.
//
// Optional `environment` + `background` strings name one of the studio
// environments from `studios.js` — when set, applying the preset will
// chain through to `applyStudio(env)` so a single preset call configures
// the full pipeline.

export const RENDER_PRESETS = Object.freeze({
  draft: {
    name: 'draft',
    toneMapping: 'LinearToneMapping',
    exposure: 1.0,
    shadowQuality: 'basic',
    antialias: false,
    pixelRatio: 0.75,
    sampleCount: 8,
  },
  standard: {
    name: 'standard',
    toneMapping: 'ACESFilmicToneMapping',
    exposure: 1.0,
    shadowQuality: 'pcf',
    antialias: true,
    pixelRatio: 1.0,
    sampleCount: 64,
  },
  pro: {
    name: 'pro',
    toneMapping: 'ACESFilmicToneMapping',
    exposure: 1.1,
    shadowQuality: 'pcfsoft',
    antialias: true,
    pixelRatio: 1.5,
    sampleCount: 256,
  },
  photo: {
    name: 'photo',
    toneMapping: 'AgXToneMapping',
    exposure: 1.15,
    shadowQuality: 'vsm',
    antialias: true,
    pixelRatio: 2.0,
    sampleCount: 1024,
  },
  preview_clay: {
    name: 'preview_clay',
    toneMapping: 'NeutralToneMapping',
    exposure: 1.0,
    shadowQuality: 'pcfsoft',
    antialias: true,
    pixelRatio: 1.0,
    sampleCount: 32,
    environment: 'lookdev_neutral',
    background: '#c8c8c8',
  },
  preview_xray: {
    name: 'preview_xray',
    toneMapping: 'LinearToneMapping',
    exposure: 1.2,
    shadowQuality: 'basic',
    antialias: false,
    pixelRatio: 1.0,
    sampleCount: 16,
    background: '#06080c',
  },
  studio_white: {
    name: 'studio_white',
    toneMapping: 'NeutralToneMapping',
    exposure: 1.1,
    shadowQuality: 'pcfsoft',
    antialias: true,
    pixelRatio: 1.5,
    sampleCount: 128,
    environment: 'whitestudio',
    background: '#f4f5f6',
  },
  turntable_bright: {
    name: 'turntable_bright',
    toneMapping: 'AgXToneMapping',
    exposure: 1.2,
    shadowQuality: 'pcfsoft',
    antialias: true,
    pixelRatio: 1.5,
    sampleCount: 96,
    environment: 'turntable_a',
    background: '#dddddd',
  },
});

export const RENDER_PRESET_NAMES = Object.freeze(Object.keys(RENDER_PRESETS));

export function listRenderPresets() {
  return RENDER_PRESET_NAMES.slice();
}

export function getRenderPreset(name) {
  return RENDER_PRESETS[name] || null;
}

export function isKnownRenderPreset(name) {
  return Object.prototype.hasOwnProperty.call(RENDER_PRESETS, name);
}
