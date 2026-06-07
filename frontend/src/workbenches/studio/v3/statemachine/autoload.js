import { installStateMachine } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installStateMachine(); } catch (_) {} }); } } catch (_) {}
export default installStateMachine;
