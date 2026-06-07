import { installMegaLoad } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installMegaLoad(); } catch (_) {} }); } } catch (_) {}
export default installMegaLoad;
