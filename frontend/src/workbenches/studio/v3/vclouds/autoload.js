// ArchDisc Studio V3 — slice 892 — vclouds autoload.
import { installVClouds } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installVClouds(); } catch (_) {} });
  }
} catch (_) {}
export default installVClouds;
