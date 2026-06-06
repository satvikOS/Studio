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
  // Auto-enable.
  setTimeout(() => enable(), 800);
}
