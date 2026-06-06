// Slice 728 — Architecture engineering depth.

import { registerOps } from '../common/registry.js';
import { footingsFromOutline, joistFloor, wallStuds, roofRafters } from './eng.js';

let _installed = false;

export function installArchEng() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioArchEngFootings: footingsFromOutline,
    __studioArchEngJoistFloor: joistFloor,
    __studioArchEngWallStuds: wallStuds,
    __studioArchEngRoofRafters: roofRafters,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'arch', 'Arch engineering — footings / joist floor / wall studs / roof rafters');
}
