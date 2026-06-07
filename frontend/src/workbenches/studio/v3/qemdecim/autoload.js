// ArchDisc Studio V3 — qemdecim autoload.
import { installQEMDecim } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installQEMDecim(); } catch (_) {} });
  }
} catch (_) {}
export default installQEMDecim;
