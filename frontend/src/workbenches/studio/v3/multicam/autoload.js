import { installMultiCam } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installMultiCam(); } catch (_) {} }); } } catch (_) {}
export default installMultiCam;
