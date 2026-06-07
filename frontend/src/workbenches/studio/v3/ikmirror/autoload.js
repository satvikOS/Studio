// ArchDisc Studio V3 — ikmirror autoload.
import { installIKMirror } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installIKMirror(); } catch (_) {} });
  }
} catch (_) {}
export default installIKMirror;
