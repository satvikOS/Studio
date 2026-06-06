// Slice 718 — 3ds Max Hair & Fur with guide curves.

import { registerOps } from '../common/registry.js';
import { applyHair, setWind, comb, removeHair, listHair } from './hair.js';

let _installed = false;

export function installMaxHair() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioMaxHairApply: applyHair,
    __studioMaxHairSetWind: setWind,
    __studioMaxHairComb: comb,
    __studioMaxHairRemove: removeHair,
    __studioMaxHairList: listHair,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rt', '3ds Max Hair & Fur — guide curves + wind + comb');
}
