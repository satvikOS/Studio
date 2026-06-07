// ArchDisc Studio V3 — Marvelous Designer multi-layer garment stack
// autoloader (slice 780).
//
// Single-line side-effect installer mirroring cloth2/autoload.js. Defers
// `installClothLayer()` one microtask so `registerV3Api()` has a chance
// to land `window.__studioCommandRegister` before the cloth-layer ops
// try to register; the registerOps helper retries on a short interval
// anyway, but the microtask gate keeps the happy path zero-retry.

import { installClothLayer } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installClothLayer(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installClothLayer;
