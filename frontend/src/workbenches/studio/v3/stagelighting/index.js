// Slice 713 — KeyShot-style stage lighting setups.

import { registerOps } from '../common/registry.js';
import {
  threePoint, ringLight, softboxFill, rimLight, cyclorama,
  listSetups, clearSetup,
} from './setups.js';

let _installed = false;

export function installStageLighting() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioStage3Point: threePoint,
    __studioStageRingLight: ringLight,
    __studioStageSoftbox: softboxFill,
    __studioStageRimLight: rimLight,
    __studioStageCyclorama: cyclorama,
    __studioStageList: listSetups,
    __studioStageClear: clearSetup,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rt', 'KeyShot stage lighting — 3-point / ring / softbox / rim / cyclorama');
}
