// Slice 708 — Maya muscle deformer.

import { registerOps } from '../common/registry.js';
import {
  createMuscle, setAnchors, setBulgeStrength, setBaseRadius,
  setSkinMesh, deleteMuscle, listMuscles,
} from './muscle.js';

let _installed = false;

export function installMuscle() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioMuscleCreate: createMuscle,
    __studioMuscleSetAnchors: setAnchors,
    __studioMuscleSetBulgeStrength: setBulgeStrength,
    __studioMuscleSetBaseRadius: setBaseRadius,
    __studioMuscleSetSkinMesh: setSkinMesh,
    __studioMuscleDelete: deleteMuscle,
    __studioMuscleList: listMuscles,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rig', 'Maya muscle deformer (anchored bulge with falloff)');
}
