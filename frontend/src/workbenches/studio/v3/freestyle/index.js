// Slice 703 — Freestyle NPR line art.

import { registerOps } from '../common/registry.js';
import { enable, disable, setConfig, getConfig, isEnabled } from './lineart.js';

let _installed = false;

export function installFreestyle() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioFreestyleEnable: enable,
    __studioFreestyleDisable: disable,
    __studioFreestyleSetConfig: setConfig,
    __studioFreestyleGetConfig: getConfig,
    __studioFreestyleIsEnabled: isEnabled,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rt', 'Freestyle NPR line-art overlay (silhouette + crease edges)');
}
