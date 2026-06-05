// ArchDisc Studio V3 — Quad-view (multiview) autoloader.
//
// Single-line installer. Tests (and any wiring that wants the
// __studioMultiView* surface available before the user clicks anything)
// side-effect-import this module:
//
//   import('/src/workbenches/studio/v3/multiview/autoload.js');
//
// Install is deferred one tick so registerV3Api() has had a chance to
// populate the command registry + __archdiscViewport, matching the
// pattern used by animadv/autoload.js + shader/autoload.js etc.

import { installMultiView } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installMultiView(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installMultiView;
