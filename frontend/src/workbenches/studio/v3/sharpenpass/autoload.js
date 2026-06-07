import { installSharpenPass } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installSharpenPass(); } catch (_) {} }); } } catch (_) {}
export default installSharpenPass;
