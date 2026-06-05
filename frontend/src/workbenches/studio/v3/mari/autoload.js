// ArchDisc Studio V3 — Mari autoload entry.
//
// Side-effect import installs the Mari UDIM + multi-channel paint
// surface. Tests hot-load this file directly via `await import(...)` so
// the e2e spec works even when the api.js orchestrator hasn't been
// patched to import this slice yet (per the Mari slice ground rule of
// not touching api.js).

import { installMari } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installMari(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installMari;
