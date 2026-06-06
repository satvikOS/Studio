// Slice 719 — Unreal Blueprint macros library.

import { registerOps } from '../common/registry.js';
import { define, invoke, listMacros, remove, preloadLibrary } from './macros.js';

let _installed = false;

export function installUEMacros() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioUEMacroDefine: define,
    __studioUEMacroInvoke: invoke,
    __studioUEMacroList: listMacros,
    __studioUEMacroRemove: remove,
    __studioUEMacroPreloadLibrary: preloadLibrary,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'bp', 'Unreal Blueprint macros — define / invoke / library');
  setTimeout(() => preloadLibrary(), 100);
}
