// ArchDisc Studio V3 — ReSTIR autoload (slice 792).
import { installReSTIR } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installReSTIR(); } catch (_) {} });
  }
} catch (_) {}
export default installReSTIR;
