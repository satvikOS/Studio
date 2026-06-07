// ArchDisc Studio V3 — godrays autoload.
import { installGodRays } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installGodRays(); } catch (_) {} });
  }
} catch (_) {}
export default installGodRays;
