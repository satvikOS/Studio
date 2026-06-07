import { installCubeProbes } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installCubeProbes(); } catch (_) {} }); } } catch (_) {}
export default installCubeProbes;
