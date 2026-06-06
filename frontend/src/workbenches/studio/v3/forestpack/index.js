// Slice 725 — 3ds Max Forest Pack-style procedural scatter.

import { registerOps } from '../common/registry.js';
import { createScatter, deleteScatter, listScatters } from './scatter.js';

let _installed = false;

export function installForestPack() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioForestPackCreate: createScatter,
    __studioForestPackDelete: deleteScatter,
    __studioForestPackList: listScatters,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'fx', 'Forest Pack procedural scatter — surface sample + jitter + distribution map + collision');
}
