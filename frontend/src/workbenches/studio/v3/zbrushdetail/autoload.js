// ArchDisc Studio V3 — ZBrush localized brush detail autoloader (slice 758).
//
// Mirrors `voxel/autoload.js`: a single-line side-effect installer that
// defers `installZBrushDetail()` by one microtask so it lands after
// `registerV3Api()` has populated `window.__studioCommandRegister`. The
// installer itself retries op registration on a short interval via
// `common/registry.js`, so installation is robust to cold-start ordering.

import { installZBrushDetail } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installZBrushDetail(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installZBrushDetail;
