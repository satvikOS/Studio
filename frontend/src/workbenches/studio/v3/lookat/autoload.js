import { installLookAt } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installLookAt(); } catch (_) {} }); } } catch (_) {}
export default installLookAt;
