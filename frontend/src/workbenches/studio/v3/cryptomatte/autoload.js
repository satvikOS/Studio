import { installCryptomatte } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installCryptomatte(); } catch (_) {} }); } } catch (_) {}
export default installCryptomatte;
