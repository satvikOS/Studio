// Slice 699 — Texture map baking ops.

import { registerOps } from '../common/registry.js';
import {
  bakeAOMap, bakeCurvatureMap, bakeNormalMap, bakeHeightMap, bakeCavityMap,
} from './baker.js';

let _installed = false;

export function installBakeMaps() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioBakeAOMap: bakeAOMap,
    __studioBakeCurvatureMap: bakeCurvatureMap,
    __studioBakeNormalMap: bakeNormalMap,
    __studioBakeHeightMap: bakeHeightMap,
    __studioBakeCavityMap: bakeCavityMap,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'texpaint', 'Texture map baking (AO/curvature/normal/height/cavity)');
}
