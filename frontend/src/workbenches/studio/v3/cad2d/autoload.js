// ArchDisc Studio V3 — cad2d autoloader (slice 774).
//
// Single-line installer matched by api.js's
//   `import('./cad2d/autoload.js')`
// orchestration. Importing this file installs the AutoCAD-style 2D
// drawing surface under __studioCAD2D* on window — see ./index.js for
// the full op contract.

import { installCAD2D } from './index.js';

Promise.resolve().then(() => {
  try { installCAD2D(); } catch (_) { /* swallow — see index.js */ }
});

export default installCAD2D;
