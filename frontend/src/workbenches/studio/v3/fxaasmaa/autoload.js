import { installFXAASMAA } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installFXAASMAA(); } catch (_) {} }); } } catch (_) {}
export default installFXAASMAA;
