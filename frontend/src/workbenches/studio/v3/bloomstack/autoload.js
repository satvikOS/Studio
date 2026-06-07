import { installBloomStack } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installBloomStack(); } catch (_) {} }); } } catch (_) {}
export default installBloomStack;
