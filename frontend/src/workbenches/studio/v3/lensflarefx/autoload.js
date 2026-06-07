// ArchDisc Studio V3 — lensflarefx autoload.
import { installLensFlareFX } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installLensFlareFX(); } catch (_) {} });
  }
} catch (_) {}
export default installLensFlareFX;
