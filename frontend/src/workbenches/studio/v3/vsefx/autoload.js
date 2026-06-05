// ArchDisc Studio V3 — VSE FX autoloader.
//
// Side-effect installer. Tests (and the orchestrator, when wired)
// side-effect-import this module to install the VSE FX op surface +
// pipe transition / effect registries into the slice-690 VSE engine
// if it exists.
//
//   import('/src/workbenches/studio/v3/vsefx/autoload.js');
//
// Install is deferred one tick so registerV3Api() and any in-flight
// VSE autoload have already populated the command registry +
// transition/effect registry hooks. Same pattern as vse/autoload.js.

import { installVSEFX } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installVSEFX(); } catch (_) { /* swallow — install is best-effort */ }
    });
  }
} catch (_) { /* ignore */ }

export default installVSEFX;
