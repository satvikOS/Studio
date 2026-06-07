import { installCelShader } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installCelShader(); } catch (_) {} }); } } catch (_) {}
export default installCelShader;
