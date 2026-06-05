// ArchDisc Studio V3 — snap2 autoloader.
//
// Single-line side-effect installer. The e2e spec (and the orchestrator
// once we wire it in) dynamic-imports this module to install every
// __studioSnap2* op + the side widget:
//
//   await import('/src/workbenches/studio/v3/snap2/autoload.js');
//
// Install is deferred one tick so registerV3Api() has had a chance to
// populate __studioCommandRegister + __studioSnapState. Same pattern
// used by gp/autoload.js, csg/autoload.js, sculpt/autoload.js.

import { installSnap2 } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installSnap2(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installSnap2;
