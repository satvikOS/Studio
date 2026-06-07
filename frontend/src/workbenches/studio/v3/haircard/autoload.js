// ArchDisc Studio V3 — haircard autoload.
import { installHairCard } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installHairCard(); } catch (_) {} }); } } catch (_) {}
export default installHairCard;
