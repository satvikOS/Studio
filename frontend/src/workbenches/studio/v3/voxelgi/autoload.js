import { installVoxelGI } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installVoxelGI(); } catch (_) {} }); } } catch (_) {}
export default installVoxelGI;
