// ArchDisc Studio V3 — onionskin autoload.
import { installOnionSkin } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installOnionSkin(); } catch (_) {} });
  }
} catch (_) {}
export default installOnionSkin;
