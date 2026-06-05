// ArchDisc Studio V3 — ASL (VEX-style) autoloader.
//
// Single-line installer. Tests + the orchestrator side-effect-import
// this module to install the VEX op surface + editor:
//
//   import('/src/workbenches/studio/v3/vex/autoload.js');
//
// Install is deferred one microtask so registerV3Api() has had a
// chance to populate __studioSelectedMesh + __studioCommandRegister —
// matching the pattern used by anim/autoload.js + shader/autoload.js.

import { installVex } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installVex(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installVex;
