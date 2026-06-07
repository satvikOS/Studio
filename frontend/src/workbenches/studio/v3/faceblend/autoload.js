// ArchDisc Studio V3 — faceblend autoload.
import { installFaceBlend } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installFaceBlend(); } catch (_) {} }); } } catch (_) {}
export default installFaceBlend;
