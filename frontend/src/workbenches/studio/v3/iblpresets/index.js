// Slice 727 — HDRI / IBL environment presets.

import { registerOps } from '../common/registry.js';
import { applyPreset, clearEnv, getCurrent, listPresets } from './presets.js';

let _installed = false;

export function installIBLPresets() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioIBLPresetApply: applyPreset,
    __studioIBLPresetClear: clearEnv,
    __studioIBLPresetGetCurrent: getCurrent,
    __studioIBLPresetList: listPresets,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rt', 'HDRI environment presets — studio / sunset / overcast / blue_hour / dusk / night / desert_sun / snow_day');
}
