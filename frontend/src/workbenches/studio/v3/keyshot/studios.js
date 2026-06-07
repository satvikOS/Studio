// Slice 772 — KeyShot studio environments.
//
// Catalogue of 10 KeyShot-style studio lighting environments. Each entry
// describes the equirect environment name (matching one of the procedural
// HDRs from slice 770's `hdrlib`), the IBL intensity / rotation Y, the
// renderer tone-mapping mode + exposure, plus optional fog / sun / 3-point
// stage parameters that the apply path forwards into the existing Studio
// stage-lighting ops (`__studioStage3Point` + `__studioSetFog`).
//
// All entries are pure-data — no THREE or DOM dependencies — so the file
// is safe to import from any environment (tests + worker contexts).
//
// Tone-mapping codes match `THREE.*ToneMapping` constants:
//   'NoToneMapping'         → 0
//   'LinearToneMapping'     → 1
//   'ReinhardToneMapping'   → 2
//   'CineonToneMapping'     → 3
//   'ACESFilmicToneMapping' → 4
//   'AgXToneMapping'        → 6 (r161+)
//   'NeutralToneMapping'    → 7 (r166+)
//
// The apply path resolves the string → THREE constant at call-time.

export const STUDIO_ENVIRONMENTS = Object.freeze({
  product_photography: {
    name: 'product_photography',
    hdr: 'studio_softbox',
    intensity: 1.2,
    rotation: 30,
    toneMapping: 'ACESFilmicToneMapping',
    exposure: 1.05,
    fill: { color: 0xffffff, intensity: 0.6, position: [-2, 1.5, 1.5] },
    rim: { color: 0xffffff, intensity: 0.9, position: [0, 1.5, -2.5] },
  },
  beauty_shot: {
    name: 'beauty_shot',
    hdr: 'studio_warm',
    intensity: 1.35,
    rotation: 45,
    toneMapping: 'AgXToneMapping',
    exposure: 1.15,
    fill: { color: 0xfff1d6, intensity: 0.7, position: [-1.8, 2, 1.2] },
    rim: { color: 0xfff1d6, intensity: 1.1, position: [0.4, 2.2, -2.6] },
  },
  sketchfab_classic: {
    name: 'sketchfab_classic',
    hdr: 'studio_cool',
    intensity: 1.0,
    rotation: 0,
    toneMapping: 'ACESFilmicToneMapping',
    exposure: 1.0,
    fill: { color: 0xcfd9e6, intensity: 0.55, position: [-2, 1.4, 1.2] },
    rim: { color: 0xe0e8f0, intensity: 0.85, position: [0, 1.6, -2.5] },
  },
  whitestudio: {
    name: 'whitestudio',
    hdr: 'studio_white',
    intensity: 1.1,
    rotation: 0,
    toneMapping: 'NeutralToneMapping',
    exposure: 1.1,
    fill: { color: 0xffffff, intensity: 0.7, position: [-2, 2, 1.5] },
    rim: { color: 0xffffff, intensity: 0.95, position: [0, 2, -2.5] },
  },
  dark_studio: {
    name: 'dark_studio',
    hdr: 'dramatic_red',
    intensity: 0.45,
    rotation: 60,
    toneMapping: 'CineonToneMapping',
    exposure: 0.85,
    fog: { color: 0x050608, near: 6, far: 30 },
    rim: { color: 0xff8050, intensity: 1.5, position: [-1.2, 1.8, -2.4] },
    fill: { color: 0x2030ff, intensity: 0.35, position: [2, 1.4, 1.6] },
  },
  rim_light: {
    name: 'rim_light',
    hdr: 'dramatic_split',
    intensity: 0.55,
    rotation: 90,
    toneMapping: 'ACESFilmicToneMapping',
    exposure: 0.95,
    rim: { color: 0xffffff, intensity: 1.8, position: [0, 1.6, -2.8] },
    fill: { color: 0x202428, intensity: 0.2, position: [-2.2, 1.2, 1.0] },
  },
  turntable_a: {
    name: 'turntable_a',
    hdr: 'studio_softbox',
    intensity: 1.15,
    rotation: 0,
    toneMapping: 'ACESFilmicToneMapping',
    exposure: 1.0,
    fill: { color: 0xffffff, intensity: 0.65, position: [-2, 1.5, 1.5] },
    rim: { color: 0xffffff, intensity: 0.9, position: [0, 1.5, -2.5] },
  },
  turntable_b: {
    name: 'turntable_b',
    hdr: 'studio_cool',
    intensity: 1.05,
    rotation: 180,
    toneMapping: 'AgXToneMapping',
    exposure: 1.05,
    fill: { color: 0xd6dde6, intensity: 0.55, position: [-2, 1.5, 1.5] },
    rim: { color: 0xe2e8ee, intensity: 0.85, position: [0, 1.5, -2.5] },
  },
  lookdev_neutral: {
    name: 'lookdev_neutral',
    hdr: 'colorgrade_modern',
    intensity: 1.0,
    rotation: 0,
    toneMapping: 'NeutralToneMapping',
    exposure: 1.0,
    fill: { color: 0xcccccc, intensity: 0.5, position: [-2, 1.5, 1.5] },
    rim: { color: 0xcccccc, intensity: 0.65, position: [0, 1.5, -2.5] },
  },
  lookdev_warm: {
    name: 'lookdev_warm',
    hdr: 'colorgrade_vintage',
    intensity: 1.1,
    rotation: 25,
    toneMapping: 'AgXToneMapping',
    exposure: 1.08,
    sun: { color: 0xffd9a8, intensity: 1.2, position: [2.5, 3.2, 2.2] },
    fill: { color: 0xffe1bf, intensity: 0.55, position: [-2, 1.5, 1.5] },
    rim: { color: 0xffe9c5, intensity: 0.7, position: [0, 1.5, -2.5] },
  },
});

export const STUDIO_NAMES = Object.freeze(Object.keys(STUDIO_ENVIRONMENTS));

export function listStudios() {
  return STUDIO_NAMES.slice();
}

export function getStudio(name) {
  return STUDIO_ENVIRONMENTS[name] || null;
}

export function isKnownStudio(name) {
  return Object.prototype.hasOwnProperty.call(STUDIO_ENVIRONMENTS, name);
}
