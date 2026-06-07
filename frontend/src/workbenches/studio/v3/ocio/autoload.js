// ArchDisc Studio V3 — ocio autoload.
import { installOCIO } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installOCIO(); } catch (_) {} }); } } catch (_) {}
export default installOCIO;
