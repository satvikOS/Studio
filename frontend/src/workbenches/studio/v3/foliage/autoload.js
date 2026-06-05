// ArchDisc Studio V3 — foliage autoloader.
//
// Single-line side-effect installer. The orchestrator can wire
// `import('./foliage/autoload.js').catch(() => {});` into api.js, which
// triggers `installFoliage()` on first import. Until that wire-up
// lands, the e2e spec dynamic-imports this module directly off the
// Vite dev server.
//
// Defers one microtask so the install runs after registerV3Api() has
// populated `window.__studioCommandRegister`. Errors are swallowed so
// SSR / mocked-DOM environments don't blow up the rest of api.js.

import { installFoliage } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installFoliage(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installFoliage;
