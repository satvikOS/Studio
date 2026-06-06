// Slice 714 — Houdini-style ocean simulator.

import { registerOps } from '../common/registry.js';
import { createOcean, setWindSpeed, setChoppy, addWave, listOceans, deleteOcean } from './ocean.js';

let _installed = false;

export function installOceanSim() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioOceanCreate: createOcean,
    __studioOceanSetWindSpeed: setWindSpeed,
    __studioOceanSetChoppy: setChoppy,
    __studioOceanAddWave: addWave,
    __studioOceanList: listOceans,
    __studioOceanDelete: deleteOcean,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'sim', 'Houdini ocean — Gerstner-style multi-wave animated sea surface');
}
