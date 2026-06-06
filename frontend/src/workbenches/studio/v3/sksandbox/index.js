// Slice 717 — SketchUp Sandbox terrain tools.

import { registerOps } from '../common/registry.js';
import { fromContours, smoove, stamp, drapeCurve, flipEdge, listTerrains } from './sandbox.js';

let _installed = false;

export function installSKSandbox() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioSKSandboxFromContours: fromContours,
    __studioSKSandboxSmoove: smoove,
    __studioSKSandboxStamp: stamp,
    __studioSKSandboxDrape: drapeCurve,
    __studioSKSandboxFlipEdge: flipEdge,
    __studioSKSandboxList: listTerrains,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'arch', 'SketchUp Sandbox — from-contours, smoove, stamp, drape, flip-edge');
}
