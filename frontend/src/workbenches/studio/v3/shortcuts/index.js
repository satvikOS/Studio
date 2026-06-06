// Slice 721 — Keyboard shortcuts manager.

import { registerOps } from '../common/registry.js';
import { bind, unbind, listBindings, clearAll, loadDefaults } from './binder.js';

let _installed = false;

export function installShortcuts() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioShortcutsBind: bind,
    __studioShortcutsUnbind: unbind,
    __studioShortcutsList: listBindings,
    __studioShortcutsClearAll: clearAll,
    __studioShortcutsLoadDefaults: loadDefaults,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'multiview', 'Keyboard shortcuts — bind / unbind / load Blender-ish defaults');
}
