// Slice 708 — Substance Painter texture-set baker.

import { registerOps } from '../common/registry.js';
import { bakeNormalFromHigh, bakePosition, bakeThickness } from './baker.js';

let _installed = false;

export function installSBaker() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioSBakerNormalFromHigh: bakeNormalFromHigh,
    __studioSBakerPosition: bakePosition,
    __studioSBakerThickness: bakeThickness,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'texpaint', 'Substance Painter texture baker (normal-from-high / position / thickness)');
}
