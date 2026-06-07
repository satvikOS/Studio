import { installFootIK } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installFootIK(); } catch (_) {} }); } } catch (_) {}
export default installFootIK;
