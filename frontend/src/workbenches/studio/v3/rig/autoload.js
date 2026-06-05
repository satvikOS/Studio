// ArchDisc Studio V3 — rig autoloader.
//
// Single-line installer. api.js gets `import('./rig/autoload.js')`
// wired in by the orchestrator (this slice can't touch api.js itself),
// which side-effect-imports this module and installs the rig op surface.

import { installRigging } from './index.js';

installRigging();

export default installRigging;
