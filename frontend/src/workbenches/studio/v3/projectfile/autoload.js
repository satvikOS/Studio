import { installProjectFile } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installProjectFile(); } catch (_) {} }); } } catch (_) {}
export default installProjectFile;
