// ArchDisc Studio V3 — slice 892 — volumetric cloud presets.
//
// Six canonical sky states matching the Sebastian Lague + Horizon Zero
// Dawn tutorial vocabulary. Each preset bundles the physical-process
// knobs the raymarcher reads: coverage (how full the sky is), the cloud
// layer altitudes, base + detail noise scales, sigma_a / sigma_s
// extinction + scattering coefficients, anisotropy g for the
// Henyey-Greenstein phase function, ambient floor, and a height-gradient
// type that picks the curve in noise3D.js#heightGradient.

export const CLOUD_PRESETS = {
  cumulus: {
    name: 'cumulus',
    description: 'Fluffy fair-weather cumulus — scattered puffy clouds',
    coverage: 0.55,
    cloudLayerBottom: 1.5,
    cloudLayerTop: 3.5,
    baseScale: 0.18,
    detailScale: 0.55,
    density: 1.4,
    sigmaA: 0.04,
    sigmaS: 1.6,
    anisotropy: 0.55,
    ambient: 0.18,
    heightType: 'cumulus',
    skyTopColor: [0.30, 0.50, 0.95],
    skyHorizonColor: [0.65, 0.78, 0.92],
    sunColor: [1.0, 0.95, 0.85],
  },
  cirrus: {
    name: 'cirrus',
    description: 'Thin high-altitude wispy ice clouds',
    coverage: 0.30,
    cloudLayerBottom: 4.0,
    cloudLayerTop: 6.0,
    baseScale: 0.10,
    detailScale: 0.80,
    density: 0.45,
    sigmaA: 0.02,
    sigmaS: 0.9,
    anisotropy: 0.70,
    ambient: 0.25,
    heightType: 'cirrus',
    skyTopColor: [0.22, 0.42, 0.92],
    skyHorizonColor: [0.55, 0.72, 0.95],
    sunColor: [1.0, 0.98, 0.92],
  },
  stratus: {
    name: 'stratus',
    description: 'Low flat featureless overcast sheet',
    coverage: 0.85,
    cloudLayerBottom: 0.8,
    cloudLayerTop: 1.8,
    baseScale: 0.08,
    detailScale: 0.40,
    density: 1.2,
    sigmaA: 0.08,
    sigmaS: 1.4,
    anisotropy: 0.30,
    ambient: 0.32,
    heightType: 'stratus',
    skyTopColor: [0.45, 0.50, 0.60],
    skyHorizonColor: [0.60, 0.62, 0.68],
    sunColor: [0.85, 0.80, 0.75],
  },
  storm: {
    name: 'storm',
    description: 'Towering cumulonimbus thunderhead — dark base, bright anvil',
    coverage: 0.92,
    cloudLayerBottom: 0.5,
    cloudLayerTop: 5.5,
    baseScale: 0.16,
    detailScale: 0.65,
    density: 2.5,
    sigmaA: 0.18,
    sigmaS: 2.2,
    anisotropy: 0.40,
    ambient: 0.08,
    heightType: 'storm',
    skyTopColor: [0.18, 0.20, 0.28],
    skyHorizonColor: [0.30, 0.32, 0.38],
    sunColor: [1.0, 0.85, 0.65],
  },
  fair_weather: {
    name: 'fair_weather',
    description: 'Sparse cumulus, bright deep-blue sky, classic summer day',
    coverage: 0.32,
    cloudLayerBottom: 1.8,
    cloudLayerTop: 3.2,
    baseScale: 0.20,
    detailScale: 0.60,
    density: 1.1,
    sigmaA: 0.03,
    sigmaS: 1.5,
    anisotropy: 0.60,
    ambient: 0.20,
    heightType: 'cumulus',
    skyTopColor: [0.20, 0.45, 1.00],
    skyHorizonColor: [0.62, 0.80, 0.96],
    sunColor: [1.0, 0.96, 0.88],
  },
  overcast: {
    name: 'overcast',
    description: 'Full sky coverage, diffuse, grey, no direct sun',
    coverage: 0.95,
    cloudLayerBottom: 1.0,
    cloudLayerTop: 3.0,
    baseScale: 0.12,
    detailScale: 0.45,
    density: 1.8,
    sigmaA: 0.12,
    sigmaS: 1.8,
    anisotropy: 0.25,
    ambient: 0.40,
    heightType: 'cumulus',
    skyTopColor: [0.55, 0.58, 0.62],
    skyHorizonColor: [0.68, 0.70, 0.72],
    sunColor: [0.80, 0.78, 0.74],
  },
};

export const CLOUD_PRESET_NAMES = Object.keys(CLOUD_PRESETS);

export function getPreset(name) {
  const p = CLOUD_PRESETS[name];
  if (!p) return null;
  // Defensive shallow + small-array clone so callers can mutate freely.
  return {
    ...p,
    skyTopColor: p.skyTopColor.slice(),
    skyHorizonColor: p.skyHorizonColor.slice(),
    sunColor: p.sunColor.slice(),
  };
}

export function listPresets() {
  return CLOUD_PRESET_NAMES.map((n) => ({
    name: n,
    description: CLOUD_PRESETS[n].description,
    coverage: CLOUD_PRESETS[n].coverage,
    layerBottom: CLOUD_PRESETS[n].cloudLayerBottom,
    layerTop: CLOUD_PRESETS[n].cloudLayerTop,
  }));
}
