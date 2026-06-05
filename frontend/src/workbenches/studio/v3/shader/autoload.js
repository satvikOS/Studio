// ArchDisc Studio V3 — shader graph autoload entry.
//
// Importing this module installs the shader graph into the V3 window
// surface. Designed for the api.js orchestrator wire-up:
//
//   import('./shader/autoload.js').catch(() => {});
//
// The install runs once per page-load. Re-imports are no-ops.

import { installShaderGraph } from './index.js';

// Run install eagerly on import. Bury errors so a missing window (SSR,
// tests with mocked DOM) never blocks the rest of api.js.
try {
  if (typeof window !== 'undefined') {
    // Defer one tick so the shader install lands after api.js's own
    // registerV3Api() has populated __studioSelectedMesh + the command
    // registry, which we then enrich with category 'shader' entries.
    Promise.resolve().then(() => {
      try { installShaderGraph(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export {};
