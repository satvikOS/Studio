import { installGameUI } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installGameUI(); } catch (_) {} }); } } catch (_) {}
export default installGameUI;
