// Slice 706 — Hair-shell fur.

import { registerOps } from '../common/registry.js';
import { applyFur, clearFur, setLength, setDensity, setColor, listFur } from './fur.js';

let _installed = false;

export function installFur() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioFurApply: applyFur,
    __studioFurClear: clearFur,
    __studioFurSetLength: setLength,
    __studioFurSetDensity: setDensity,
    __studioFurSetColor: setColor,
    __studioFurList: listFur,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rt', 'XGen / Yeti / Blender hair-shell fur (Maya parity)');
}
