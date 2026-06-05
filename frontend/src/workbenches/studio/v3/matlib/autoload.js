// ArchDisc Studio V3 — Material Library autoload entry.
//
// Importing this module installs the matlib into the V3 window surface.
// Designed for the api.js orchestrator wire-up:
//
//   import('./matlib/autoload.js').catch(() => {});
//
// The install runs once per page-load. Re-imports are no-ops. The e2e
// spec dynamic-imports this file directly when api.js hasn't been
// wired yet, mirroring the shader/sculpt/texpaint convention.

import { installMatLib } from './index.js';

try {
  if (typeof window !== 'undefined') {
    // Defer one tick so the install lands after api.js's
    // registerV3Api() has populated __studioSelectedMesh + the command
    // registry, which we then enrich with category 'matlib' entries.
    Promise.resolve().then(() => {
      try { installMatLib(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export {};
