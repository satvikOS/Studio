// ArchDisc Studio V3 — ssrfx autoload.
import { installSSRFX } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installSSRFX(); } catch (_) {} });
  }
} catch (_) {}
export default installSSRFX;
