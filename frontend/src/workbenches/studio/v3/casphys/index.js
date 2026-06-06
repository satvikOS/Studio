// Slice 710 — Cascadeur physics-pose solver.

import { registerOps } from '../common/registry.js';
import { addPin, removePin, clearPins, solve, ghostPhysics, listPins } from './physpose.js';

let _installed = false;

export function installCasPhys() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioCasPhysAddPin: addPin,
    __studioCasPhysRemovePin: removePin,
    __studioCasPhysClearPins: clearPins,
    __studioCasPhysSolve: solve,
    __studioCasPhysGhostPhysics: ghostPhysics,
    __studioCasPhysListPins: listPins,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'anim', 'Cascadeur physics-pose: pinned IK + auto-balance over support polygon');
}
