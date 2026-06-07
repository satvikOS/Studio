// ArchDisc Studio V3 — motionvecfx autoload.
import { installMotionVecFX } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installMotionVecFX(); } catch (_) {} });
  }
} catch (_) {}
export default installMotionVecFX;
