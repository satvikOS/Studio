// ArchDisc Studio V3 — waterflow autoload.
import { installWaterFlow } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installWaterFlow(); } catch (_) {} });
  }
} catch (_) {}
export default installWaterFlow;
