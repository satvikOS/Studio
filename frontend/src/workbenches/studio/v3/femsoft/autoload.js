// ArchDisc Studio V3 — femsoft autoload (slice 783).
import { installFEMSoft } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installFEMSoft(); } catch (_) {} });
  }
} catch (_) {}
export default installFEMSoft;
