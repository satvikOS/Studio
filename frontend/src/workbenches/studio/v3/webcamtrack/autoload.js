import { installWebcamTrack } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installWebcamTrack(); } catch (_) {} }); } } catch (_) {}
export default installWebcamTrack;
