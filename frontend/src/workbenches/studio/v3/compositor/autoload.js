// ArchDisc Studio V3 — compositor autoload entry.
//
// Importing this module installs the compositor into the V3 window
// surface. Mirrors shader/autoload.js + rig/autoload.js so the same
// dynamic-import pattern used by the other V3 e2e specs works here:
//
//   await import('/src/workbenches/studio/v3/compositor/autoload.js');
//
// The install runs once per page-load. Re-imports are no-ops.

import { installCompositor } from './index.js';

try {
  if (typeof window !== 'undefined') {
    // Defer one microtask so the command registry from api.js's
    // registerV3Api() has been seeded before we try to register our
    // category-tagged commands against it. If the registry isn't up yet
    // (e.g. autoload runs before the shell mounts), index.js's
    // regCommand() helper retries on the next macrotask.
    Promise.resolve().then(() => {
      try { installCompositor(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installCompositor;
