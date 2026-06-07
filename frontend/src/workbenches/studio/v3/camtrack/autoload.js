import { installCamTrack } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installCamTrack(); } catch (_) {} }); } } catch (_) {}
export default installCamTrack;
