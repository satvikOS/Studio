// Slice 726 — Workbench tab strip.

import { registerOps } from '../common/registry.js';
import {
  enable, disable, setTab, getCurrentTab, getTabCategories, listTabs,
} from './tabs.js';

let _installed = false;

export function installUIWorkbenches() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioWorkbenchesEnable: enable,
    __studioWorkbenchesDisable: disable,
    __studioWorkbenchesSetTab: setTab,
    __studioWorkbenchesGetCurrentTab: getCurrentTab,
    __studioWorkbenchesGetTabCategories: getTabCategories,
    __studioWorkbenchesList: listTabs,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'multiview', 'Workbench tab strip — Modeling / Sculpt / Anim / Render / Sim / Compositing');
  // Slice 742 (UI fix): do NOT auto-mount the floating tab strip. The V3
  // shell already owns top-level navigation (the discipline rail + the
  // horizontal discipline buttons), so auto-enabling this legacy strip
  // produced a second, non-Forge-styled tab row overlapping the shell.
  // The ops remain registered so it can still be toggled on deliberately
  // via __studioWorkbenchesEnable for the V2 monolith / debugging.
}
