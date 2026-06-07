import { installLensDirt } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installLensDirt(); } catch (_) {} }); } } catch (_) {}
export default installLensDirt;
