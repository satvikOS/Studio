// ArchDisc Studio V3 — editmore autoloader.
//
// Single-line side-effect installer. Tests (and the orchestrator, if it
// ever wires us in via api.js) import this module to light up the 12
// deeper edit-mode operators:
//
//   import('/src/workbenches/studio/v3/editmore/autoload.js');
//
// Install is deferred one tick so registerV3Api() has had a chance to
// populate __studioSelectedMesh + the command registry, mirroring the
// pattern used by anim/autoload.js + shader/autoload.js.

import { installEditMore } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installEditMore(); } catch (_) { /* swallow — never crash boot */ }
    });
  }
} catch (_) { /* ignore */ }

export default installEditMore;
