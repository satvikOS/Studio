import { installTriggerVol } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installTriggerVol(); } catch (_) {} }); } } catch (_) {}
export default installTriggerVol;
