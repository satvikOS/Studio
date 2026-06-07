import { installAnimState } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installAnimState(); } catch (_) {} }); } } catch (_) {}
export default installAnimState;
