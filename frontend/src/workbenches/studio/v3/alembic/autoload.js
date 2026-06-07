// ArchDisc Studio V3 — alembic autoload.
import { installAlembic } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installAlembic(); } catch (_) {} }); } } catch (_) {}
export default installAlembic;
