import { installPostChain } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installPostChain(); } catch (_) {} }); } } catch (_) {}
export default installPostChain;
