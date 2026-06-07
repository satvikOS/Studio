import { installMotionVecMRT } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installMotionVecMRT(); } catch (_) {} }); } } catch (_) {}
export default installMotionVecMRT;
