import { installSaveLoad } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installSaveLoad(); } catch (_) {} }); } } catch (_) {}
export default installSaveLoad;
