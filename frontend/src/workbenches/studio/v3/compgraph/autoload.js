import { installCompGraph } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installCompGraph(); } catch (_) {} }); } } catch (_) {}
export default installCompGraph;
