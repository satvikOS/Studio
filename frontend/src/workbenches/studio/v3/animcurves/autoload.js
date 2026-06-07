// ArchDisc Studio V3 — animcurves autoload.
import { installAnimCurves } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installAnimCurves(); } catch (_) {} });
  }
} catch (_) {}
export default installAnimCurves;
