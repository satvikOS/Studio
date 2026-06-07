// ArchDisc Studio V3 — archelem autoload.
import { installArchElem } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installArchElem(); } catch (_) {} }); } } catch (_) {}
export default installArchElem;
