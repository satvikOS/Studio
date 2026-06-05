// Slice 701 — Plasticity-style parametric history.

import { registerOps } from '../common/registry.js';
import {
  ensureHistory, recordOp, setEnabled, reorder, removeEntry, setArgs,
  rebuild, flatten, listEntries, exportHistory,
} from './history.js';

let _installed = false;

export function installPlasticityHist() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioPHEnsure: (uuid) => { ensureHistory(uuid); return { ok: true }; },
    __studioPHRecordOp: recordOp,
    __studioPHSetEnabled: setEnabled,
    __studioPHReorder: reorder,
    __studioPHRemoveEntry: removeEntry,
    __studioPHSetArgs: setArgs,
    __studioPHRebuild: rebuild,
    __studioPHFlatten: flatten,
    __studioPHListEntries: listEntries,
    __studioPHExport: exportHistory,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'edit', 'Plasticity-style parametric history stack');
}
