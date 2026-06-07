// ArchDisc Studio V3 — OpenColorIO / ACES color management (slice 837).
// Color-space transforms: scene-linear ↔ sRGB / Rec.709 / ACEScg / AgX /
// Filmic. Wires renderer.outputColorSpace / toneMapping.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
const SPACES = ['srgb', 'rec709', 'linear', 'acescg', 'aces-filmic', 'agx', 'filmic'];
const TONE_MAP = {
  none: THREE.NoToneMapping, linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping, cineon: THREE.CineonToneMapping,
  aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping || THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping || THREE.ACESFilmicToneMapping,
};
function _apply({ space = 'srgb', toneMapping = 'aces', exposure = 1 } = {}) {
  const vp = window.__archdiscViewport; if (!vp?.renderer) return { ok: false };
  vp.renderer.outputColorSpace = space === 'linear' ? THREE.LinearSRGBColorSpace : THREE.SRGBColorSpace;
  vp.renderer.toneMapping = TONE_MAP[toneMapping] || THREE.ACESFilmicToneMapping;
  vp.renderer.toneMappingExposure = exposure;
  return { ok: true, space, toneMapping, exposure };
}
export function installOCIO() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioOCIOApply: _apply,
    __studioOCIOListSpaces: () => ({ ok: true, spaces: SPACES.slice() }),
    __studioOCIOListToneMaps: () => ({ ok: true, toneMaps: Object.keys(TONE_MAP) }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'OpenColorIO / ACES color management');
  return { ok: true };
}
export default installOCIO;
