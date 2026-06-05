// ArchDisc Studio V3 — edit-ops barrel.
//
// Re-exports installEditOps() and uninstallEditOps() from editops.js so
// the rest of the V3 surface can import './edit' as a stable entry-point
// without caring about internal file layout.

export { installEditOps, uninstallEditOps, isInstalled } from './editops.js';
