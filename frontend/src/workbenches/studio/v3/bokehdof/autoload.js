import { installBokehDOF } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installBokehDOF(); } catch (_) {} }); } } catch (_) {}
export default installBokehDOF;
