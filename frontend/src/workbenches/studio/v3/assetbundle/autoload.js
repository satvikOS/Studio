import { installAssetBundle } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installAssetBundle(); } catch (_) {} }); } } catch (_) {}
export default installAssetBundle;
