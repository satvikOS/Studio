// ArchDisc Studio V3 — gpurt autoload.
import { installGPURT } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installGPURT(); } catch (_) {} }); } } catch (_) {}
export default installGPURT;
