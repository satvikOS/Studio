import { installShadowCasc } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installShadowCasc(); } catch (_) {} }); } } catch (_) {}
export default installShadowCasc;
