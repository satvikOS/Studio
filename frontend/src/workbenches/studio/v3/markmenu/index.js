// Slice 725 — Maya marking menu.

import { registerOps } from '../common/registry.js';
import { defineMenu, enable, disable, listMenus, loadDefaults } from './radial.js';

let _installed = false;

export function installMarkMenu() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioMarkMenuDefine: defineMenu,
    __studioMarkMenuEnable: enable,
    __studioMarkMenuDisable: disable,
    __studioMarkMenuList: listMenus,
    __studioMarkMenuLoadDefaults: loadDefaults,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'multiview', 'Maya marking menu — radial action pie on Alt+left or right-click drag');
  setTimeout(() => loadDefaults(), 200);
}
