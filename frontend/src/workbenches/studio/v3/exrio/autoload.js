import { installEXRIO } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installEXRIO(); } catch (_) {} }); } } catch (_) {}
export default installEXRIO;
