// ArchDisc Studio V3 — Push/Pull autoload (slice 747).
import { installPushPull } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installPushPull(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installPushPull;
