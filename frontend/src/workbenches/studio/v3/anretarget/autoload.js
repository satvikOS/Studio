// ArchDisc Studio V3 — anretarget autoloader (slice 762).
//
// Single-line installer matched by api.js's `import('./anretarget/autoload.js')`
// orchestration.

import { installAnRetarget } from './index.js';

Promise.resolve().then(installAnRetarget);

export default installAnRetarget;
