// Slice 729 — Marvelous Designer real-time fitting.

import { registerOps } from '../common/registry.js';
import { attach, setEnabled, setGravity, detach, listFittings } from './realtime.js';

let _installed = false;

export function installMDFit2() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioMDFit2Attach: attach,
    __studioMDFit2SetEnabled: setEnabled,
    __studioMDFit2SetGravity: setGravity,
    __studioMDFit2Detach: detach,
    __studioMDFit2List: listFittings,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'sim', 'MD real-time fitting — garment continuously settles around a posed body');
}
