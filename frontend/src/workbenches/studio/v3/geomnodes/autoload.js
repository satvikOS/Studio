// ArchDisc Studio V3 — geometry-nodes autoload entry.
//
// Importing this module installs the geometry-nodes graph into the V3
// window surface. The api.js orchestrator wires:
//
//   import('./geomnodes/autoload.js').catch(() => {});
//
// The install runs once per page-load. Re-imports are no-ops.

import { installGeomNodes } from './index.js';

try {
  if (typeof window !== 'undefined') {
    // Defer one tick so the install lands after api.js's own
    // registerV3Api() has populated the command registry, which we
    // then enrich with category 'geomnodes' entries.
    Promise.resolve().then(() => {
      try { installGeomNodes(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export {};
