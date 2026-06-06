// Slice 712 — Marvelous Designer measurement + fit testing.

import { registerOps } from '../common/registry.js';
import {
  addMeasurement, refresh, getFitMap, getStandardLevels,
  removeMeasurement, listMeasurements,
} from './measure.js';

let _installed = false;

export function installMDFit() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioMDFitAddMeasurement: addMeasurement,
    __studioMDFitRefresh: refresh,
    __studioMDFitGetFitMap: getFitMap,
    __studioMDFitGetStandardLevels: getStandardLevels,
    __studioMDFitRemove: removeMeasurement,
    __studioMDFitList: listMeasurements,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'sim', 'Marvelous Designer measurement tape + fit-map');
}
