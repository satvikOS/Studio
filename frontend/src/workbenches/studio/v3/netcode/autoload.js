import { installNetcode } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installNetcode(); } catch (_) {} }); } } catch (_) {}
export default installNetcode;
