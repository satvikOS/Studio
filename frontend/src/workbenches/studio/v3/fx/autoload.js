// ArchDisc Studio V3 — fx autoloader.
//
// Single-line installer. The e2e spec imports this module directly via
// the Vite dev-server URL when api.js orchestration hasn't been updated
// to dynamic-import it yet (same pattern as sim/autoload.js). Re-imports
// are no-ops (guarded by window.__studioFXInstalled).
//
// Defers one microtask so the install lands after api.js's own
// registerV3Api() has populated the command registry, which we then
// enrich with category 'fx' entries.

import { installFX } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installFX(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installFX;
