// ArchDisc Studio V3 — foliagewind autoload.
import { installFoliageWind } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installFoliageWind(); } catch (_) {} }); } } catch (_) {}
export default installFoliageWind;
