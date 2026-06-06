// Slice 719 — Substance Painter generators.

import { registerOps } from '../common/registry.js';
import {
  curvatureGenerator, aoCavityGenerator, dirtGenerator,
  positionGradient, proceduralEdgeHighlight, combineMasks,
} from './generators.js';

let _installed = false;

export function installSPGens() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioSPGenCurvature: curvatureGenerator,
    __studioSPGenAOCavity: aoCavityGenerator,
    __studioSPGenDirt: dirtGenerator,
    __studioSPGenPosGradient: positionGradient,
    __studioSPGenEdgeHighlight: proceduralEdgeHighlight,
    __studioSPGenCombineMasks: combineMasks,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'texpaint', 'Substance Painter mask generators — curvature / AO cavity / dirt / position / edge / combine');
}
