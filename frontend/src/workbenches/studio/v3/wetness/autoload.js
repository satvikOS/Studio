// ArchDisc Studio V3 — wetness autoload.
import { installWetness } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installWetness(); } catch (_) {} }); } } catch (_) {}
export default installWetness;
