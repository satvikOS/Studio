// ArchDisc Studio V3 — lumengi autoload.
import { installLumenGI } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installLumenGI(); } catch (_) {} });
  }
} catch (_) {}
export default installLumenGI;
