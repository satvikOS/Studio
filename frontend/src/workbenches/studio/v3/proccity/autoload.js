// ArchDisc Studio V3 — proccity autoload.
import { installProcCity } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installProcCity(); } catch (_) {} });
  }
} catch (_) {}
export default installProcCity;
