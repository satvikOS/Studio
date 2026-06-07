// ArchDisc Studio V3 — sdgraphedit autoload.
import { installSDGraphEdit } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installSDGraphEdit(); } catch (_) {} });
  }
} catch (_) {}
export default installSDGraphEdit;
