// ArchDisc Studio V3 — stress autoload.
import { installStress } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installStress(); } catch (_) {} });
  }
} catch (_) {}
export default installStress;
