import { installReverbZone } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installReverbZone(); } catch (_) {} }); } } catch (_) {}
export default installReverbZone;
