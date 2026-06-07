// ArchDisc Studio V3 — hairdyn autoload.
import { installHairDyn } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installHairDyn(); } catch (_) {} });
  }
} catch (_) {}
export default installHairDyn;
