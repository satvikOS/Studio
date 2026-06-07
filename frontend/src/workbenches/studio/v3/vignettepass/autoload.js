import { installVignettePass } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installVignettePass(); } catch (_) {} }); } } catch (_) {}
export default installVignettePass;
