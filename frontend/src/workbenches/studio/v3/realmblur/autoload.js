import { installRealMBlur } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installRealMBlur(); } catch (_) {} }); } } catch (_) {}
export default installRealMBlur;
