// Slice 721 — Bottom status bar.

import { registerOps } from '../common/registry.js';
import { enable, disable, isEnabled } from './bar.js';

let _installed = false;

export function installUIStatusBar() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioStatusBarEnable: enable,
    __studioStatusBarDisable: disable,
    __studioStatusBarIsEnabled: isEnabled,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'multiview', 'Bottom status bar — FPS / verts / tris / camera / selection / save state');
  // Slice 743 (UI polish): do NOT auto-enable this injected absolute
  // bottom:0 debug strip. The Forge-style V3 shell renders its OWN polished
  // status bar (discipline · mode · prim/vert/tri counts · fps · snap ·
  // save state); auto-enabling this stacked a second raw "FPS V T cam Sel"
  // strip (plus a debug tick-ruler) under it at the very bottom edge. The
  // enable/disable ops stay registered for the V2 monolith / debugging.
}
