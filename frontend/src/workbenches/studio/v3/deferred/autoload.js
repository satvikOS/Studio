import { installDeferred } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installDeferred(); } catch (_) {} }); } } catch (_) {}
export default installDeferred;
