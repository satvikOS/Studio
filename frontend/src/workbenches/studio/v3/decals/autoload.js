// ArchDisc Studio V3 — decals autoload.
import { installDecals } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installDecals(); } catch (_) {} });
  }
} catch (_) {}
export default installDecals;
