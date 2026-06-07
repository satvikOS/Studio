// ArchDisc Studio V3 — pathtrace autoload.
import { installPathTrace } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installPathTrace(); } catch (_) {} });
  }
} catch (_) {}
export default installPathTrace;
