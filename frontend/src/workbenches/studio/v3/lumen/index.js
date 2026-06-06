// Slice 706 — Unreal Lumen-style real-time GI.

import { registerOps } from '../common/registry.js';
import { enable, disable, reset, stats } from './surfacecache.js';

let _installed = false;

export function installLumen() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioLumenEnable: enable,
    __studioLumenDisable: disable,
    __studioLumenReset: reset,
    __studioLumenStats: stats,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'rt', 'Unreal Lumen-style real-time GI via per-mesh surface cache');
}
