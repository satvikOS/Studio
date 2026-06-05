// ArchDisc Studio V3 — vector autoloader.
//
// Single-line installer. Side-effect-imports this module to install
// the __studioVector* op surface plus the 'vector' command palette
// category. Re-imports are no-ops (guarded by
// window.__studioVectorInstalled).
//
// Defers one microtask so the install lands after api.js's own
// registerV3Api() has populated the command registry, which we then
// enrich with category 'vector' entries.

import { installVector } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installVector(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installVector;
