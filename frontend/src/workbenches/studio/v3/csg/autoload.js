// ArchDisc Studio V3 — Real-CSG autoloader.
//
// Single-line side-effect installer. Until api.js is updated to wire
// `import('./csg/autoload.js').catch(() => {})` alongside the other
// workbench autoloads, the e2e spec dynamic-imports this module
// directly off the Vite dev server:
//
//   await import('/src/workbenches/studio/v3/csg/autoload.js');
//
// Same pattern as `geomnodes/autoload.js` and the other workbenches
// that landed before their orchestrator wire-up. Defers one tick so
// `installCSG()` lands after `registerV3Api()` has populated
// `window.__studioCommandRegister` — `installCSG()` also re-tries
// command registration on a short interval as a belt-and-braces guard.

import { installCSG } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installCSG(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installCSG;
