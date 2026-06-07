// ArchDisc Studio V3 — ifc autoload.
import { installIFC } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installIFC(); } catch (_) {} }); } } catch (_) {}
export default installIFC;
