// ArchDisc Studio V3 — Poisson-disk scatter autoloader (slice 755).
//
// Mirrors voxel/autoload.js. Single-line side-effect installer that
// defers `installScatter()` one microtask so `registerV3Api()` has
// landed `window.__studioCommandRegister` before the scatter ops try
// to register; the registerOps helper retries anyway, but the
// microtask gate keeps the happy path zero-retry.
//
// api.js wires `import('./scatter/autoload.js').catch(() => {});` next
// to the other workbench autoloads.

import { installScatter } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installScatter(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installScatter;
