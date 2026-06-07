// ArchDisc Studio V3 — texatlas autoload.
import { installTexAtlas } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installTexAtlas(); } catch (_) {} }); } } catch (_) {}
export default installTexAtlas;
