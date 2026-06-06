// Slice 722 — Project autosave.

import { registerOps } from '../common/registry.js';
import {
  snapshotNow, restoreLatest, restore, listSnapshots, deleteSnapshot,
  start, stop, isEnabled,
} from './saver.js';

let _installed = false;

export function installAutosave() {
  if (_installed) return;
  _installed = true;

  const ops = {
    __studioAutosaveSnapshotNow: snapshotNow,
    __studioAutosaveRestoreLatest: restoreLatest,
    __studioAutosaveRestore: restore,
    __studioAutosaveList: listSnapshots,
    __studioAutosaveDelete: deleteSnapshot,
    __studioAutosaveStart: start,
    __studioAutosaveStop: stop,
    __studioAutosaveIsEnabled: isEnabled,
  };
  for (const [name, fn] of Object.entries(ops)) {
    window[name] = fn;
  }
  registerOps(ops, 'multiview', 'Project autosave — IndexedDB snapshot every N sec');
  // Auto-start with 90s default.
  setTimeout(() => start(90), 1500);
}
