// Slice 726 — Substance Painter Smart Materials.

import { registerOps } from '../common/registry.js';
import { listMaterials, applyMaterial, getApplied, defineMaterial } from './smart.js';

let _installed = false;

export function installSPSmartMat() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioSPSmartMatList: listMaterials,
    __studioSPSmartMatApply: applyMaterial,
    __studioSPSmartMatGetApplied: getApplied,
    __studioSPSmartMatDefine: defineMaterial,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'texpaint', 'Substance Painter Smart Materials — 8 PBR presets with edge-wear + dirt layers');
}
