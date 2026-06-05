// ArchDisc Studio V3 — geomtotal autoload entry.
//
// Importing this module installs the 30 additional Geometry Node kinds
// into the V3 window surface. Deferred three micro-tasks so api.js's
// registerV3Api() (which sets up __studioCommandRegister), the slice-684
// geomnodes/autoload.js, and the slice-688 geomdeep/autoload.js have all
// already run — that way our editor registration (if available) and
// command-palette enrichment land on populated infrastructure.
//
// Re-imports are no-ops thanks to installGeomTotal()'s _installed flag.

import { installGeomTotal } from './index.js';

try {
  if (typeof window !== 'undefined') {
    // Three ticks: tick 1 lets api.js finish, tick 2 lets
    // geomnodes/autoload.js call installGeomNodes(), tick 3 lets
    // geomdeep/autoload.js call installGeomDeep() — only then do we
    // layer geomtotal on top.
    Promise.resolve()
      .then(() => Promise.resolve())
      .then(() => Promise.resolve())
      .then(() => {
        try { installGeomTotal(); } catch (_) { /* swallow */ }
      });
  }
} catch (_) { /* ignore */ }

export {};
