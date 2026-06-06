// ArchDisc Studio V3 — Inference snap autoload (slice 748).
import { installInference } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installInference(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installInference;
