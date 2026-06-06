// Slice 719 — UV island packing.

import { registerOps } from '../common/registry.js';
import { packIslands, listIslands, layOut } from './pack.js';

let _installed = false;

export function installUVPack() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioUVPackIslands: packIslands,
    __studioUVPackListIslands: listIslands,
    __studioUVPackLayOut: layOut,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'edit', 'UV island packing — find disjoint islands + shelf-pack into [0,1]');
}
