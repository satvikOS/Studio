// ArchDisc Studio V3 — caustics autoload.
import { installCaustics } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installCaustics(); } catch (_) {} }); } } catch (_) {}
export default installCaustics;
