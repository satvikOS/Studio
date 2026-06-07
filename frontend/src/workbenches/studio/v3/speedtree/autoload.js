// ArchDisc Studio V3 — speedtree autoload.
import { installSpeedTree } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installSpeedTree(); } catch (_) {} });
  }
} catch (_) {}
export default installSpeedTree;
