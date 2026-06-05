// ArchDisc Studio V3 — surfaces autoloader.
//
// Side-effect-importable installer. Tests + the V3 orchestrator (if it
// ever wires us in via api.js) light up the surface-op surface by:
//
//   import('/src/workbenches/studio/v3/surfaces/autoload.js');
//
// Install is deferred one tick so registerV3Api() has populated
// __studioSelectedMesh + the command registry — same pattern as
// editmore/autoload.js + shader/autoload.js.

import { installSurfaces } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installSurfaces(); } catch (_) { /* swallow — never crash boot */ }
    });
  }
} catch (_) { /* ignore */ }

export default installSurfaces;
