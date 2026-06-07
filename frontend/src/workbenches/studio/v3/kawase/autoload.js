import { installKawase } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installKawase(); } catch (_) {} }); } } catch (_) {}
export default installKawase;
