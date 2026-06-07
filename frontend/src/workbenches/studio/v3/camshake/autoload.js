// ArchDisc Studio V3 — camshake autoload.
import { installCamShake } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installCamShake(); } catch (_) {} });
  }
} catch (_) {}
export default installCamShake;
