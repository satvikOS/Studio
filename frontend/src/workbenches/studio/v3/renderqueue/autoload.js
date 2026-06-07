import { installRenderQueue } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installRenderQueue(); } catch (_) {} }); } } catch (_) {}
export default installRenderQueue;
