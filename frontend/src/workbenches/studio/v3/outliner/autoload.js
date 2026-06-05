// ArchDisc Studio V3 — Outliner autoload entry.
//
// Importing this module installs the outliner window surface. The
// install is deferred one microtask so api.js has time to register the
// command registry, which we then enrich with category 'outliner'.
//
// The e2e spec dynamic-imports this file directly when api.js hasn't
// been wired yet, mirroring the shader/sculpt/matlib convention.

import { installOutliner } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installOutliner(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export {};
