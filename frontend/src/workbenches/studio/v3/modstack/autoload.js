// ArchDisc Studio V3 — modifier stack autoloader.
//
// Side-effect installer. The orchestrator wires
// `import('./modstack/autoload.js').catch(() => {});` into api.js
// when ready; until then, the e2e spec dynamic-imports this module
// directly off the Vite dev server.
//
// Defers one tick so the install runs after `registerV3Api()` has
// populated `window.__studioCommandRegister`. Errors are swallowed
// so SSR / mocked-DOM environments don't blow up imports.

import { installModStack } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installModStack(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installModStack;
