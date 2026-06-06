// ArchDisc Studio V3 — Catmull-Clark autoload (slice 749).
import { installCatmullClark } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installCatmullClark(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installCatmullClark;
