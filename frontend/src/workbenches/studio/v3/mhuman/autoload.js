import { installMHuman } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installMHuman(); } catch (_) {} }); } } catch (_) {}
export default installMHuman;
