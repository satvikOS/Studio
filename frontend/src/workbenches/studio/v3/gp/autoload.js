// ArchDisc Studio V3 — Grease Pencil autoloader.
//
// Single-line installer. Tests (and the orchestrator, if it ever wires
// us in) side-effect-import this module to install the GP op surface
// + side panel.
//
//   import('/src/workbenches/studio/v3/gp/autoload.js');
//
// Install is deferred one tick so registerV3Api() has had a chance to
// populate __studioSelectedMesh + the command registry, mirroring the
// pattern used by anim/autoload.js + sculpt/autoload.js.

import { installGreasePencil } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installGreasePencil(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installGreasePencil;
