import { installSpatial3D } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installSpatial3D(); } catch (_) {} }); } } catch (_) {}
export default installSpatial3D;
