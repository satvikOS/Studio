import { installSpotCookie } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installSpotCookie(); } catch (_) {} }); } } catch (_) {}
export default installSpotCookie;
