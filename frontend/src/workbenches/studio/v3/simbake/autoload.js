// ArchDisc Studio V3 — sim-bake autoloader.
//
// Single-line installer. The api.js orchestrator can wire this up via:
//
//   import('./simbake/autoload.js').catch(() => {});
//
// Side-effect-imports this module and installs the
// window.__studioSimBake* op surface + body-attached BakePanel.
// Re-imports are no-ops (guarded by window.__studioSimBakeInstalled).
//
// Defers one microtask so the install lands after api.js's
// registerV3Api() has populated the command registry — we then enrich
// it with category 'sim' entries.

import { installSimBake } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installSimBake(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installSimBake;
