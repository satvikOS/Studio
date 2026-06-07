import { installChromAbPass } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installChromAbPass(); } catch (_) {} }); } } catch (_) {}
export default installChromAbPass;
