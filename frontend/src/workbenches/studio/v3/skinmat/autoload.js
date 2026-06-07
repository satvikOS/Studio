// ArchDisc Studio V3 — skinmat autoload.
import { installSkinMat } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installSkinMat(); } catch (_) {} }); } } catch (_) {}
export default installSkinMat;
