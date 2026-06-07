// ArchDisc Studio V3 — lodchain autoload.
import { installLODChain } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installLODChain(); } catch (_) {} }); } } catch (_) {}
export default installLODChain;
