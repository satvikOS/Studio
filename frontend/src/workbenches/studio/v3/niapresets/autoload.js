// ArchDisc Studio V3 — niapresets autoload.
import { installNiaPresets } from './index.js';
try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => { try { installNiaPresets(); } catch (_) {} });
  }
} catch (_) {}
export default installNiaPresets;
