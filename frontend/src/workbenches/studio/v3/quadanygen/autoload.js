// ArchDisc Studio V3 — quadanygen autoload.
import { installQuadAnyGen } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installQuadAnyGen(); } catch (_) {} });
  }
} catch (_) {}
export default installQuadAnyGen;
