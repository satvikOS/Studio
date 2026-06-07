// ArchDisc Studio V3 — animals autoload.
import { installAnimals } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installAnimals(); } catch (_) {} }); } } catch (_) {}
export default installAnimals;
