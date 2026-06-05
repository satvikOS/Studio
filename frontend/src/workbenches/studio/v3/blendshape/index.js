// Slice 701 — Blendshape (morph target) animation system.

import { registerOps } from '../common/registry.js';
import {
  addTarget, setWeight, setWeightByName, apply, removeTarget,
  listTargets, captureCurrentAsTarget, resetToBase, clearTargets,
} from './targets.js';

let _installed = false;

export function installBlendshape() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioBlendshapeAddTarget: addTarget,
    __studioBlendshapeSetWeight: setWeight,
    __studioBlendshapeSetWeightByName: setWeightByName,
    __studioBlendshapeApply: apply,
    __studioBlendshapeRemoveTarget: removeTarget,
    __studioBlendshapeListTargets: listTargets,
    __studioBlendshapeCaptureCurrent: captureCurrentAsTarget,
    __studioBlendshapeResetToBase: resetToBase,
    __studioBlendshapeClear: clearTargets,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'anim', 'Blendshape / morph-target animation system');
}
