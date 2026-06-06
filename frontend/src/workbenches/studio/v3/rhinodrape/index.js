// Slice 714 — Rhino drape + N-rail loft + boundary surface.

import { registerOps } from '../common/registry.js';
import { drape, loftNRail, boundarySurface } from './drape.js';

let _installed = false;

export function installRhinoDrape() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioRhinoDrape: drape,
    __studioRhinoLoftNRail: loftNRail,
    __studioRhinoBoundarySurface: boundarySurface,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'edit', 'Rhino drape / N-rail loft / Coons boundary surface');
}
