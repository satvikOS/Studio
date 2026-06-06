// Slice 705 — ZBrush ZSpheres + Adaptive Skin.

import { registerOps } from '../common/registry.js';
import {
  createTree, addSphere, moveSphere, setRadius, removeSphere,
  bakeAdaptiveSkin, listTrees, deleteTree,
} from './zsphere.js';

let _installed = false;

export function installZSpheres() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioZSphereCreateTree: createTree,
    __studioZSphereAddSphere: addSphere,
    __studioZSphereMoveSphere: moveSphere,
    __studioZSphereSetRadius: setRadius,
    __studioZSphereRemoveSphere: removeSphere,
    __studioZSphereBakeSkin: bakeAdaptiveSkin,
    __studioZSphereListTrees: listTrees,
    __studioZSphereDeleteTree: deleteTree,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'sculpt', 'ZBrush ZSphere skeleton sketcher + adaptive skin baker');
}
