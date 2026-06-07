import { installLensDirtPass } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installLensDirtPass(); } catch (_) {} }); } } catch (_) {}
export default installLensDirtPass;
