// ArchDisc Studio V3 — geomdeep autoload entry.
//
// Importing this module installs the 20 deeper Houdini-SOP-style
// geometry-node kinds into the V3 window surface. Deferred one
// micro-task so api.js's registerV3Api() (which sets up
// __studioCommandRegister) and geomnodes/autoload.js (slice 684) have
// already run — that way our editor registration (if available) and
// command-palette enrichment both land on populated infrastructure.
//
// Re-imports are no-ops thanks to installGeomDeep()'s _installed flag.

import { installGeomDeep } from './index.js';

try {
  if (typeof window !== 'undefined') {
    // Two ticks: tick 1 lets api.js finish, tick 2 lets geomnodes/autoload.js
    // call installGeomNodes() (which is what would publish a future
    // __studioGeomRegisterNode hook if that path ever lights up).
    Promise.resolve()
      .then(() => Promise.resolve())
      .then(() => {
        try { installGeomDeep(); } catch (_) { /* swallow */ }
      });
  }
} catch (_) { /* ignore */ }

export {};
