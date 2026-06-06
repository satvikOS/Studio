// Slice 699 — Texture map baking ops.
// Slice 746 — __studioBakeAOMap / __studioBakeNormalMap /
// __studioBakePositionMap now hit the REAL per-texel UV-grid bakers
// (bake/aoTexture.js / normalTexture.js / positionTexture.js).

import { registerOps } from '../common/registry.js';
import {
  bakeAOMap, bakeCurvatureMap, bakeNormalMap, bakeHeightMap, bakeCavityMap,
  bakePositionMap,
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
    __studioBakePositionMap: bakePositionMap,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'texpaint', 'Texture map baking (AO/curvature/normal/height/cavity/position)');
}
