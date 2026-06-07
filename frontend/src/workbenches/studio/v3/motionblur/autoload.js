// ArchDisc Studio V3 — motionblur autoload.
import { installMotionBlur } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installMotionBlur(); } catch (_) {} });
  }
} catch (_) {}
export default installMotionBlur;
