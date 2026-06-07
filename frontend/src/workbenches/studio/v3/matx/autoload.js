// ArchDisc Studio V3 — matx autoload.
import { installMatX } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installMatX(); } catch (_) {} }); } } catch (_) {}
export default installMatX;
