import { installAutoExposure } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installAutoExposure(); } catch (_) {} }); } } catch (_) {}
export default installAutoExposure;
