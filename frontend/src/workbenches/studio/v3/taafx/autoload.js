// ArchDisc Studio V3 — taafx autoload.
import { installTAAFX } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installTAAFX(); } catch (_) {} });
  }
} catch (_) {}
export default installTAAFX;
