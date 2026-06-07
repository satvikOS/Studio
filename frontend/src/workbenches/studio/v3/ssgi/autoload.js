// ArchDisc Studio V3 — ssgi autoload (slice 893).
import { installSSGI } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installSSGI(); } catch (_) {} });
  }
} catch (_) {}
export default installSSGI;
