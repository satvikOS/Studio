// Slice 717 — Marvelous Designer pressure inflation.

import { registerOps } from '../common/registry.js';
import { attachPressure, step, setPressure, detach, listInflations } from './inflate.js';

let _installed = false;

export function installMDPressure() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioMDPressureAttach: attachPressure,
    __studioMDPressureStep: step,
    __studioMDPressureSet: setPressure,
    __studioMDPressureDetach: detach,
    __studioMDPressureList: listInflations,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'sim', 'Marvelous Designer pressure / stuffing inflation');
}
