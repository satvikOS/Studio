// ArchDisc Studio V3 — Geometry-Nodes 2 autoloader (slice 757).
//
// Side-effect installer. Mirrors voxel/autoload.js: defers one
// microtask so the install lands after api.js's registerV3Api() has
// populated the command registry, then installs the GN2 op surface.
//
// e2e specs can also import directly off the Vite dev server:
//   await import('/src/workbenches/studio/v3/geomnodes2/autoload.js');

import { installGeomNodes2 } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installGeomNodes2(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installGeomNodes2;
