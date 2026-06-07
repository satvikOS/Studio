// ArchDisc Studio V3 — booltol autoload.
import { installBoolTol } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installBoolTol(); } catch (_) {} });
  }
} catch (_) {}
export default installBoolTol;
