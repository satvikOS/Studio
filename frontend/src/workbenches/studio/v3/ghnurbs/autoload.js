// Slice 759 — Rhino Grasshopper NURBS palette autoloader.
//
// Single-line side-effect installer. Until api.js is updated to wire
// `import('./ghnurbs/autoload.js').catch(() => {})` alongside the other
// workbench autoloads, the e2e spec dynamic-imports this module
// directly off the Vite dev server:
//
//   await import('/src/workbenches/studio/v3/ghnurbs/autoload.js');
//
// Same pattern as voxel/autoload.js and the other workbenches that
// landed before their orchestrator wire-up. Defers one microtask so
// `installGHNurbs()` lands after `registerV3Api()` has populated
// `window.__studioCommandRegister`; `installGHNurbs()` itself retries
// command registration on a short interval as a belt-and-braces guard.

import { installGHNurbs } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installGHNurbs(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installGHNurbs;
