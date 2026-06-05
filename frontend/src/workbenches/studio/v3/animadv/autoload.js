// ArchDisc Studio V3 — Drivers + NLA autoloader.
//
// Single-line installer. Tests (and a future orchestrator wiring, if
// it ever happens) side-effect-import this module to install the
// driver + NLA op surface plus the strip editor.
//
//   import('/src/workbenches/studio/v3/animadv/autoload.js');
//
// Install is deferred one tick so registerV3Api() has had a chance to
// populate __studioSelectedMesh + the command registry, mirroring the
// pattern used by shader/autoload.js + anim/autoload.js.

import { installAnimAdv } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installAnimAdv(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installAnimAdv;
