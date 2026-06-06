// ArchDisc Studio V3 — Marvelous Designer / Chaos Cloth autoloader
// (slice 765).
//
// Single-line side-effect installer mirroring groom/autoload.js. Defers
// `installCloth2()` one microtask so `registerV3Api()` has a chance to
// land `window.__studioCommandRegister` before the cloth ops try to
// register; the registerOps helper retries on a short interval anyway,
// but the microtask gate keeps the happy path zero-retry.

import { installCloth2 } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installCloth2(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installCloth2;
