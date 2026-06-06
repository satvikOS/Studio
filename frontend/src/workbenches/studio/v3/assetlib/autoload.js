// ArchDisc Studio V3 — assetlib autoloader (slice 771).
//
// Single-line installer matched by api.js's
//   `import('./assetlib/autoload.js')`
// orchestration. Importing this file installs the catalog under
// __studioAssetLib* on window — see ./index.js for the surface contract.

import { installAssetLib } from './index.js';

Promise.resolve().then(() => {
  try { installAssetLib(); } catch (_) { /* swallow — see index.js */ }
});

export default installAssetLib;
