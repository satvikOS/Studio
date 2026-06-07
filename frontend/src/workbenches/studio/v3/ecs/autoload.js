import { installECS } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installECS(); } catch (_) {} }); } } catch (_) {}
export default installECS;
