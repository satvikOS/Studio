// Slice 718 — Plasticity continuity check + G3 fillet.

import { registerOps } from '../common/registry.js';
import { continuityCheck, g3Fillet } from './continuity.js';

let _installed = false;

export function installPlastCont() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioPlastContContinuityCheck: continuityCheck,
    __studioPlastContG3Fillet: g3Fillet,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'edit', 'Plasticity continuity check + G3 quintic-bezier fillet');
}
