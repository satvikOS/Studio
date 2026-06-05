// ArchDisc Studio V3 — voxel editor autoloader.
//
// Single-line side-effect installer. Until api.js is updated to wire
// `import('./voxel/autoload.js').catch(() => {})` alongside the other
// workbench autoloads, the e2e spec dynamic-imports this module
// directly off the Vite dev server:
//
//   await import('/src/workbenches/studio/v3/voxel/autoload.js');
//
// Same pattern as csg/autoload.js and the other workbenches that
// landed before their orchestrator wire-up. Defers one microtask so
// `installVoxel()` lands after `registerV3Api()` has populated
// `window.__studioCommandRegister`; `installVoxel()` itself retries
// command registration on a short interval as a belt-and-braces guard.

import { installVoxel } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installVoxel(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installVoxel;
