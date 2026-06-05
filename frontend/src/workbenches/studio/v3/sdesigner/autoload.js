// ArchDisc Studio V3 — sdesigner autoload entry.
//
// Importing this module installs the 25 Substance-Designer-style
// shader-node kinds into the V3 window surface and (if available) into
// the slice-684 shader graph editor. Designed for ad-hoc dynamic
// imports from tests / devtools — e.g.:
//
//   import('/src/workbenches/studio/v3/sdesigner/autoload.js');
//
// The install runs once per page-load. Re-imports are no-ops. SSR /
// missing-window environments are tolerated.

import { installSDesigner } from './index.js';

try {
  if (typeof window !== 'undefined') {
    // Defer one tick so the install lands after the slice-684 shader
    // autoload + shaderdeep have had a chance to expose
    // __studioShaderRegisterNode / the command registry that we then
    // enrich.
    Promise.resolve().then(() => {
      try { installSDesigner(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export {};
