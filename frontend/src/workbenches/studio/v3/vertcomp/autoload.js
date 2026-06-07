// ArchDisc Studio V3 — vertcomp autoload.
import { installVertComp } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installVertComp(); } catch (_) {} }); } } catch (_) {}
export default installVertComp;
