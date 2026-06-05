// Slice 697 — Cycles full BRDF for the GPU path tracer.

import { registerOps } from '../common/registry.js';
import { enable, disable, isEnabled, forceRebuild, getMatBuffer } from './bridge.js';

let _installed = false;

export function installCyclesBRDF() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioCyclesBRDFEnable: enable,
    __studioCyclesBRDFDisable: disable,
    __studioCyclesBRDFIsEnabled: () => ({ ok: true, on: isEnabled() }),
    __studioCyclesBRDFForceRebuild: forceRebuild,
    __studioCyclesBRDFGetMatBuffer: getMatBuffer,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rt', 'Cycles full BRDF integration for the GPU path tracer');
}
