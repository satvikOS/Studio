import { installPerfProf } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installPerfProf(); } catch (_) {} }); } } catch (_) {}
export default installPerfProf;
