// ArchDisc Studio V3 — sculpt brushes autoloader.
//
// Single-line installer; side-effect import to attach all 25+ brush
// ops + 5 utility ops to window.
//
// Because this slice can't touch api.js, the orchestrator wiring is
// deferred to a future slice. Until that lands, installation is
// reachable manually via:
//
//   import('./sculptbrushes/autoload.js')
//
// or:
//
//   import { installSculptBrushes } from './sculptbrushes';
//   installSculptBrushes();
//
// Idempotent — re-importing is safe.

import { installSculptBrushes } from './index.js';

installSculptBrushes();

export default installSculptBrushes;
