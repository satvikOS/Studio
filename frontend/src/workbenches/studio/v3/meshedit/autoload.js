// ArchDisc Studio V3 — meshedit autoload (slice 756).
//
// Mirrors v3/voxel/autoload.js. Side-effect installer. Until api.js wires
// `import('./meshedit/autoload.js').catch(() => {})` alongside the other
// workbench autoloads (which it does at the bottom of registerV3Api),
// the e2e spec dynamic-imports this module directly off the Vite dev
// server:
//
//   await import('/src/workbenches/studio/v3/meshedit/autoload.js');
//
// Defers one microtask so installMeshEdit() lands after registerV3Api()
// has populated window.__studioCommandRegister; installMeshEdit() itself
// retries command registration on a short interval as belt-and-braces.

import { installMeshEdit } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installMeshEdit(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installMeshEdit;
