// Slice 704 — HDRI / IBL with importance sampling.

import { registerOps } from '../common/registry.js';
import {
  loadHDRI, setIntensity, setBackgroundVisible, clearHDRI,
  sampleDirection, getStats,
} from './ibl.js';

let _installed = false;

export function installHDRI() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioHDRILoad: loadHDRI,
    __studioHDRISetIntensity: setIntensity,
    __studioHDRISetBackgroundVisible: setBackgroundVisible,
    __studioHDRIClear: clearHDRI,
    __studioHDRISampleDirection: sampleDirection,
    __studioHDRIStats: getStats,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rt', 'HDRI image-based lighting + importance-sampling CDF');
}
