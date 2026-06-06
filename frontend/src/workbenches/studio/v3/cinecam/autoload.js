// ArchDisc Studio V3 — cinematic camera autoloader (slice 766).
//
// Side-effect installer mirroring v3/groom/autoload.js. Defers
// `installCineCam()` one microtask so `registerV3Api()` has a chance to
// land `window.__studioCommandRegister` before the cinecam ops try to
// register. The `registerOps` helper retries on its own short interval
// anyway, but the microtask gate keeps the happy path zero-retry.
//
// `api.js` adds `import('./cinecam/autoload.js').catch(() => {});` next
// to the other workbench autoloads. The slice-766 e2e dynamic-imports
// this file directly off the Vite dev server as a belt-and-braces guard
// in case the autoload race ever loses to the spec's
// `__studioCineCam*` probe.

import { installCineCam } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installCineCam(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installCineCam;
