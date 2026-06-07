// ArchDisc Studio V3 — streampart autoload.
import { installStreamPart } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installStreamPart(); } catch (_) {} }); } } catch (_) {}
export default installStreamPart;
