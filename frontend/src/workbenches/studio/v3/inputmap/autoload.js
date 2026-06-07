import { installInputMap } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installInputMap(); } catch (_) {} }); } } catch (_) {}
export default installInputMap;
