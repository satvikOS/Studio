// ArchDisc Studio V3 — SVGF denoiser autoload (slice 891).
import { installDenoiser } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installDenoiser(); } catch (_) {} });
  }
} catch (_) {}
export default installDenoiser;
