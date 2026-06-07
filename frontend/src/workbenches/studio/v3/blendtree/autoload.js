import { installBlendTree } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installBlendTree(); } catch (_) {} }); } } catch (_) {}
export default installBlendTree;
