import { installRenderFarm } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installRenderFarm(); } catch (_) {} }); } } catch (_) {}
export default installRenderFarm;
