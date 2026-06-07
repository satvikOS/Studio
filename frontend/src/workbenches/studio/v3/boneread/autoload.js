// ArchDisc Studio V3 — boneread autoload.
import { installBoneReduce } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installBoneReduce(); } catch (_) {} }); } } catch (_) {}
export default installBoneReduce;
