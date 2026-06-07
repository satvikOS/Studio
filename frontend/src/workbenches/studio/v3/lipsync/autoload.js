// ArchDisc Studio V3 — lipsync autoload.
import { installLipSync } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installLipSync(); } catch (_) {} }); } } catch (_) {}
export default installLipSync;
