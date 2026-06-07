import { installConsoleReady } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installConsoleReady(); } catch (_) {} }); } } catch (_) {}
export default installConsoleReady;
