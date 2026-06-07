// ArchDisc Studio V3 — skyatm autoload.
import { installSkyAtm } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installSkyAtm(); } catch (_) {} });
  }
} catch (_) {}
export default installSkyAtm;
