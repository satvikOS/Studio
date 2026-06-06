// Slice 706 — Rhino-style 3-rail sweeps + variable fillet.

import { registerOps } from '../common/registry.js';
import { sweep1, sweep2, sweep3, variableFillet } from './sweep.js';

let _installed = false;

export function installRhinoSurf() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioRhinoSurfSweep1: sweep1,
    __studioRhinoSurfSweep2: sweep2,
    __studioRhinoSurfSweep3: sweep3,
    __studioRhinoSurfVariableFillet: variableFillet,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'edit', 'Rhino-style Sweep1/Sweep2/Sweep3 + Variable Fillet surface ops');
}
