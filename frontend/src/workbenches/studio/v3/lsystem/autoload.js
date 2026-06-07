// ArchDisc Studio V3 — lsystem autoload.
import { installLSystem } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installLSystem(); } catch (_) {} });
  }
} catch (_) {}
export default installLSystem;
