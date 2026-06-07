// ArchDisc Studio V3 — ptsss autoload.
import { installPTSSS } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installPTSSS(); } catch (_) {} }); } } catch (_) {}
export default installPTSSS;
