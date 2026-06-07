// ArchDisc Studio V3 — metabody autoload.
import { installMetaBody } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installMetaBody(); } catch (_) {} }); } } catch (_) {}
export default installMetaBody;
