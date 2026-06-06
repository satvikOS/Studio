// ArchDisc Studio V3 — Pixar USD layer composition autoloader (slice 761).
//
// Side-effect installer.  Mirrors scatter/autoload.js: defers
// `installUSDLayer()` one microtask so `registerV3Api()` has populated
// `window.__studioCommandRegister` before the USD layer ops try to
// register.  The registerOps helper retries anyway, but the microtask
// gate keeps the happy path zero-retry.
//
// e2e specs can also import directly off the Vite dev server:
//   await import('/src/workbenches/studio/v3/usdlayer/autoload.js');

import { installUSDLayer } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installUSDLayer(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installUSDLayer;
