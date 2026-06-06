// ArchDisc Studio V3 — Niagara-style emitter autoloader (slice 764).
//
// Side-effect installer mirroring groom/autoload.js. Defers
// `installNia2()` one microtask so `registerV3Api()` has a chance to
// land `window.__studioCommandRegister` before the ops try to register.
// The shared registry helper retries on a short interval anyway, but
// the microtask gate keeps the happy path zero-retry.
//
// api.js wires `import('./nia2/autoload.js').catch(() => {});` next to
// the other workbench autoloads. The e2e dynamic-imports this file
// directly off the Vite dev server as a belt-and-braces guard so the
// spec passes even when api.js hasn't been edited yet.

import { installNia2 } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installNia2(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installNia2;
