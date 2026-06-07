// ArchDisc Studio V3 — procrocks autoload.
import { installProcRocks } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installProcRocks(); } catch (_) {} });
  }
} catch (_) {}
export default installProcRocks;
