// Slice 702 — HumanIK biped autorigger.

import { registerOps } from '../common/registry.js';
import { autoRig, poseIKTarget, mirrorPose, resetToBind } from './autorig.js';

let _installed = false;

export function installHumanIK() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioHumanIKAutoRig: autoRig,
    __studioHumanIKPoseIKTarget: poseIKTarget,
    __studioHumanIKMirrorPose: [mirrorPose, 'Mirror the current pose across the sagittal plane (swap Left/Right bone rotations)'],
    __studioHumanIKResetToBind: [resetToBind, 'Reset the rig to its bind / T-pose (clear all bone rotations)'],
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = typeof fn === 'function' ? fn : fn[0];
  }
  registerOps(ops, 'rig', 'HumanIK biped autorigger (21-bone skeleton + IK chains + auto skin + mirror/reset pose)');
}
