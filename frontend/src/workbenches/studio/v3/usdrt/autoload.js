// ArchDisc Studio V3 — usdrt autoload.
import { installUSDRT } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installUSDRT(); } catch (_) {} });
  }
} catch (_) {}
export default installUSDRT;
