import { installRotoMatte } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installRotoMatte(); } catch (_) {} }); } } catch (_) {}
export default installRotoMatte;
