// Slice 726 — Plasticity Smart Tools.

import { registerOps } from '../common/registry.js';
import { smartPush, smartPull, smartDrag } from './smart.js';

let _installed = false;

export function installPlastSmart() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioPlastSmartPush: smartPush,
    __studioPlastSmartPull: smartPull,
    __studioPlastSmartDrag: smartDrag,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'edit', 'Plasticity smart tools — edge-snap-aware push / pull / drag');
}
