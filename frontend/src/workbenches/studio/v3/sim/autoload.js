// ArchDisc Studio V3 — sim autoloader.
//
// Single-line installer. Designed for the api.js orchestrator wire-up:
//
//   import('./sim/autoload.js').catch(() => {});
//
// Side-effect-imports this module and installs cloth + soft-body +
// fluid op surfaces under window.__studioCloth* / __studioSoftBody* /
// __studioFluid* plus the master __studioSim* controls. Re-imports
// are no-ops (guarded by window.__studioSimInstalled).
//
// Defers one tick so the install lands after api.js's own
// registerV3Api() has populated the command registry, which we then
// enrich with category 'sim' entries.

import { installSim } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installSim(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installSim;
