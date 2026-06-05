// ArchDisc Studio V3 — VSE autoloader.
//
// Single-line installer. Tests (and the orchestrator, if it ever
// wires us in) side-effect-import this module to install the VSE op
// surface + editor.
//
//   import('/src/workbenches/studio/v3/vse/autoload.js');
//
// Install is deferred one tick so registerV3Api() has had a chance to
// populate the command registry, mirroring the pattern used by
// anim/autoload.js + compositor/autoload.js.

import { installVSE } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installVSE(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installVSE;
