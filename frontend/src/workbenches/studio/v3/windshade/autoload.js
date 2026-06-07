import { installWindShade } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installWindShade(); } catch (_) {} }); } } catch (_) {}
export default installWindShade;
