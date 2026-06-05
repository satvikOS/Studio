// ArchDisc Studio V3 — Architecture toolkit autoloader.
//
// Single-line side-effect installer. Until api.js is updated to wire
// `import('./arch/autoload.js').catch(() => {})` alongside the other
// workbench autoloads, the e2e spec dynamic-imports this module
// directly off the Vite dev server:
//
//   await import('/src/workbenches/studio/v3/arch/autoload.js');
//
// Same pattern as `csg/autoload.js`. Defers one microtask so
// `installArch()` lands after `registerV3Api()` has populated
// `window.__studioCommandRegister`. `registerOps()` also retries
// registration on a short timer as a belt-and-braces guard.

import { installArch } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installArch(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installArch;
