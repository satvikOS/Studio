// Slice 720 — Marvelous Designer wear & fray.

import { registerOps } from '../common/registry.js';
import { attach, rip, fade, pull, listEvents, clearEvents } from './wear.js';

let _installed = false;

export function installMDWear() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioMDWearAttach: attach,
    __studioMDWearRip: rip,
    __studioMDWearFade: fade,
    __studioMDWearPull: pull,
    __studioMDWearListEvents: listEvents,
    __studioMDWearClearEvents: clearEvents,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'sim', 'Marvelous Designer wear / fray — rip / fade / pull events on garments');
}
