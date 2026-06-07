// ArchDisc Studio V3 — Substance Designer sdgen autoload (slice 775).
//
// Importing this module installs the 12 noise generators + 8 filters via
// installSDGen(). Designed for ad-hoc dynamic imports from e2e specs or
// devtools — e.g.:
//
//   import('/src/workbenches/studio/v3/sdgen/autoload.js');
//
// SSR / missing-window environments are tolerated.

import { installSDGen } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installSDGen(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export {};
