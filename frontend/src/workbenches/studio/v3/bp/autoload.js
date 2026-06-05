// ArchDisc Studio V3 — Blueprints autoload entry.
//
// Importing this module installs the Blueprints surface into the V3
// window namespace. Mirrors shader/autoload.js so the same orchestrator
// wire-up pattern applies:
//
//   import('./bp/autoload.js').catch(() => {});
//
// Install runs once per page-load; re-imports are no-ops. Errors are
// buried so missing window (SSR / DOM-mocked tests) never blocks api.js.

import { installBlueprints } from './index.js';

try {
  if (typeof window !== 'undefined') {
    // Defer one tick so install lands after api.js's own registerV3Api()
    // has populated __studioCommandRegister + __studioCommandInvoke,
    // which we then enrich with category 'bp' entries.
    Promise.resolve().then(() => {
      try { installBlueprints(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export {};
