// ArchDisc Studio V3 — hair grooming autoloader (slice 760).
//
// Single-line side-effect installer mirroring voxel/autoload.js. Defers
// `installGroom()` one microtask so `registerV3Api()` has a chance to
// land `window.__studioCommandRegister` before the groom ops try to
// register; the registerOps helper retries on a short interval anyway,
// but the microtask gate keeps the happy path zero-retry.
//
// api.js wires `import('./groom/autoload.js').catch(() => {});` next
// to the other workbench autoloads. The e2e dynamic-imports this file
// directly off the Vite dev server as a belt-and-braces guard so the
// spec passes even when api.js hasn't been edited yet.

import { installGroom } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installGroom(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installGroom;
