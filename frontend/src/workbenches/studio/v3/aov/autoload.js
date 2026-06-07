// ArchDisc Studio V3 — aov autoload.
import { installAOV } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installAOV(); } catch (_) {} }); } } catch (_) {}
export default installAOV;
