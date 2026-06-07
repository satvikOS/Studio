import { installReplay } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installReplay(); } catch (_) {} }); } } catch (_) {}
export default installReplay;
