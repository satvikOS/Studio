// ArchDisc Studio V3 — sculpt depth autoloader.
//
// Single-line installer. The orchestrator wires
// `import('./sculpt/autoload.js')` into api.js (not done in this
// slice — we can't touch api.js — so until that lands, installation
// is also reachable manually via:
//
//   window.__studioSculptDepthInstall = () =>
//     import('./sculpt/index.js').then((m) => m.installSculpt());
//
// or directly:
//
//   import { installSculpt } from './sculpt';
//   installSculpt();
//
// Side-effect importing this module installs the sculpt op surface
// immediately and is idempotent.

import { installSculpt } from './index.js';

installSculpt();

export default installSculpt;
