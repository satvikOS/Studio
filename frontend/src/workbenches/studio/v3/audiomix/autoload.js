import { installAudioMix } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installAudioMix(); } catch (_) {} }); } } catch (_) {}
export default installAudioMix;
