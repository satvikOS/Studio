// ArchDisc Studio V3 — drivers autoload.
import { installDrivers } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installDrivers(); } catch (_) {} });
  }
} catch (_) {}
export default installDrivers;
