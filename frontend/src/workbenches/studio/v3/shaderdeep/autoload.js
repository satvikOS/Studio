// ArchDisc Studio V3 — shaderdeep autoload entry.
//
// Importing this module installs the 20 deeper shader-node kinds into
// the V3 window surface and (if available) into the slice-684 shader
// graph editor. Designed for the api.js orchestrator wire-up:
//
//   import('./shaderdeep/autoload.js').catch(() => {});
//
// The install runs once per page-load. Re-imports are no-ops. SSR /
// missing-window environments are tolerated.

import { installShaderDeep } from './index.js';

try {
  if (typeof window !== 'undefined') {
    // Defer one tick so the install lands after both api.js' own
    // registerV3Api() and the slice-684 shader autoload have had a
    // chance to expose __studioShaderRegisterNode / the command
    // registry that we then enrich.
    Promise.resolve().then(() => {
      try { installShaderDeep(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export {};
