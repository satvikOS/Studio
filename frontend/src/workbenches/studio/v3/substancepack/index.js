// Slice 711 — Substance material atlas (24 procedural PBR materials).

import { registerOps } from '../common/registry.js';
import { getMaterial, listMaterials, applyMaterial, getMaterialDataURL } from './atlas.js';

let _installed = false;

export function installSubstancePack() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioSubstancePackGet: getMaterial,
    __studioSubstancePackList: listMaterials,
    __studioSubstancePackApply: applyMaterial,
    __studioSubstancePackGetDataURL: getMaterialDataURL,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'matlib', 'Substance material atlas — 24 procedural PBR materials');
}
