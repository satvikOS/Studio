// Slice 702 — HumanIK biped autorigger.

import { registerOps } from '../common/registry.js';
import { autoRig, poseIKTarget } from './autorig.js';

let _installed = false;

export function installHumanIK() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioHumanIKAutoRig: autoRig,
    __studioHumanIKPoseIKTarget: poseIKTarget,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rig', 'HumanIK biped autorigger (21-bone skeleton + IK chains + auto skin)');
}
