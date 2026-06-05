// ArchDisc Studio V3 — subdivision-surface autoloader.
//
// Single-line installer. Side-effect importing this module installs
// the subdiv op surface immediately and is idempotent. Mirrors the
// pattern used by sculpt/autoload.js and snap2/autoload.js so the
// orchestrator can wire `import('./subdiv/autoload.js')` into api.js
// when it lands.
//
// Until then, manual install via:
//
//   import { installSubdiv } from './subdiv';
//   installSubdiv();

import { installSubdiv } from './index.js';

installSubdiv();

export default installSubdiv;
