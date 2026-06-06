// Slice 709 — Plasticity X-NURB surface depth.

import { registerOps } from '../common/registry.js';
import { extendSurface, explodeToTriangles, zebraOn, zebraOff, g2EdgeFillet } from './xnurb.js';

let _installed = false;

export function installPlasticityX() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioPXExtendSurface: extendSurface,
    __studioPXExplodeToTriangles: explodeToTriangles,
    __studioPXZebraOn: zebraOn,
    __studioPXZebraOff: zebraOff,
    __studioPXG2EdgeFillet: g2EdgeFillet,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'edit', 'Plasticity X-NURB surface depth — extend / explode / zebra / G2 edge fillet');
}
