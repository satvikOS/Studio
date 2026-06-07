import { installTarget4K } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installTarget4K(); } catch (_) {} }); } } catch (_) {}
export default installTarget4K;
