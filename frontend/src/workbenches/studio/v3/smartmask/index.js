// Slice 703 — Substance Painter smart-mask generators.

import { registerOps } from '../common/registry.js';
import {
  edgeWearMask, dirtMask, heightFalloffMask, cavityMask,
  metalEdgesMask, previewMaskOnMesh,
} from './generators.js';

let _installed = false;

export function installSmartMask() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioSmartMaskEdgeWear: edgeWearMask,
    __studioSmartMaskDirt: dirtMask,
    __studioSmartMaskHeightFalloff: heightFalloffMask,
    __studioSmartMaskCavity: cavityMask,
    __studioSmartMaskMetalEdges: metalEdgesMask,
    __studioSmartMaskPreview: previewMaskOnMesh,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'texpaint', 'Substance Painter smart-mask generators');
}
