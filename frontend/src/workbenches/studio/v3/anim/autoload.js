// ArchDisc Studio V3 — animation graph autoloader.
//
// Single-line installer. Tests (and the orchestrator, if it ever wires
// us in) side-effect-import this module to install the anim op surface
// + graph editor.
//
//   import('/src/workbenches/studio/v3/anim/autoload.js');
//
// Install is deferred one tick so registerV3Api() has had a chance to
// populate __studioSelectedMesh + the command registry, mirroring the
// pattern used by shader/autoload.js.

import { installAnimGraph } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installAnimGraph(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installAnimGraph;
