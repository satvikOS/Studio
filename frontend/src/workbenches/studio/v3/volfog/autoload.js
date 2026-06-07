// ArchDisc Studio V3 — volfog autoload.
import { installVolFog } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installVolFog(); } catch (_) {} }); } } catch (_) {}
export default installVolFog;
