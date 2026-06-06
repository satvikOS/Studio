// Slice 705 — Marvelous Designer garment patterns.

import { registerOps } from '../common/registry.js';
import {
  createGarment, addPattern, addSeam, buildMesh, drape, listGarments,
} from './pattern.js';

let _installed = false;

export function installGarment() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioGarmentCreate: createGarment,
    __studioGarmentAddPattern: addPattern,
    __studioGarmentAddSeam: addSeam,
    __studioGarmentBuildMesh: buildMesh,
    __studioGarmentDrape: drape,
    __studioGarmentList: listGarments,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'sim', 'Marvelous Designer 2D patterns → 3D garment + drape');
}
