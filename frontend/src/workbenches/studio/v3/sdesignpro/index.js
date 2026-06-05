// Slice 702 — Substance Designer power tools.

import { registerOps } from '../common/registry.js';
import { tileSampler, pixelProcessor, fxMap, splatterCircular, anisotropicNoise } from './tools.js';

let _installed = false;

export function installSDesignPro() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioSDesignProTileSampler: tileSampler,
    __studioSDesignProPixelProcessor: pixelProcessor,
    __studioSDesignProFXMap: fxMap,
    __studioSDesignProSplatterCircular: splatterCircular,
    __studioSDesignProAnisotropicNoise: anisotropicNoise,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'matlib', 'Substance Designer power tools: TileSampler / PixelProcessor / FXMap / SplatterCircular / AnisotropicNoise');
}
