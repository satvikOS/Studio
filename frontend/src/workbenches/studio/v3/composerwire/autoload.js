import { installComposerWire } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installComposerWire(); } catch (_) {} }); } } catch (_) {}
export default installComposerWire;
