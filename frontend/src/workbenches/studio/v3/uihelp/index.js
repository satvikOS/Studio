// Slice 724 — UI Help panel (F1).

import { registerOps } from '../common/registry.js';
import { enable, disable, toggle, isEnabled } from './help.js';

let _installed = false;

export function installUIHelp() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioHelpOpen: enable,
    __studioHelpClose: disable,
    __studioHelpToggle: toggle,
    __studioHelpIsEnabled: isEnabled,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'multiview', 'F1 Help — searchable docs panel for every registered op');
}
