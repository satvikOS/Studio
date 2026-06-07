// ArchDisc Studio V3 — autorig autoload.
import { installAutoRig } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installAutoRig(); } catch (_) {} });
  }
} catch (_) {}
export default installAutoRig;
