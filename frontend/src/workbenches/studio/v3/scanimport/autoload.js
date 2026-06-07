// ArchDisc Studio V3 — scanimport autoload (slice 890).
import { installScanImport } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installScanImport(); } catch (_) {} });
  }
} catch (_) {}
export default installScanImport;
