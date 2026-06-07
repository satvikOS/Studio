import { installGameScript } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installGameScript(); } catch (_) {} }); } } catch (_) {}
export default installGameScript;
