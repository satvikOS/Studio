// ArchDisc Studio V3 — projection paint autoload entry.
//
// Side-effect import installs the projection-paint op surface + side
// panel. Per the api.js wiring convention, the orchestrator imports
// `./paintproj/autoload.js`; alternatively, tests can hot-load this
// file directly via `await import(...)` so e2e specs work even when
// the api.js bundle hasn't reached this slice yet.

import { installPaintProj } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installPaintProj(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installPaintProj;
