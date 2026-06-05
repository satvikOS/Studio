// ArchDisc Studio V3 — MoGraph autoloader.
//
// Single-line side-effect installer. The orchestrator wires
// `import('./mograph/autoload.js').catch(() => {});` into api.js, which
// triggers `installMoGraph()` on first import. Until that wire-up
// lands, the e2e spec dynamic-imports this module directly off the
// Vite dev server.
//
// Defers one tick so the install runs after registerV3Api() has
// populated `window.__studioCommandRegister`. Errors are swallowed so
// SSR / mocked-DOM environments don't blow up the rest of api.js.

import { installMoGraph } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installMoGraph(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installMoGraph;
