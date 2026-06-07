// ArchDisc Studio V3 — imposter autoload.
import { installImposter } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installImposter(); } catch (_) {} }); } } catch (_) {}
export default installImposter;
