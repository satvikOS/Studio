// ArchDisc Studio V3 — bvhimport autoload (slice 887).
import { installBVHImport } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installBVHImport(); } catch (_) {} });
  }
} catch (_) {}
export default installBVHImport;
