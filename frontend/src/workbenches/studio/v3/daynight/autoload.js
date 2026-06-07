// ArchDisc Studio V3 — daynight autoload.
import { installDayNight } from './index.js';
try { if (typeof window !== 'undefined') { Promise.resolve().then(() => { try { installDayNight(); } catch (_) {} }); } } catch (_) {}
export default installDayNight;
