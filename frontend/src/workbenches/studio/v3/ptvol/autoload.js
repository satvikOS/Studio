// ArchDisc Studio V3 — ptvol autoload.
import { installPTVol } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installPTVol(); } catch (_) {} }); } } catch (_) {}
export default installPTVol;
