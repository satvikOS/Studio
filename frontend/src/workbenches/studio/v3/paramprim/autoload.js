// Slice 750 — auto-installer for re-editable parametric primitives.
//
// Mirrors voxel/autoload.js: defers one microtask so installParamPrim()
// lands after registerV3Api() has populated window.__studioCommandRegister.
// The installer itself retries on a short interval as a belt-and-braces
// guard, so direct dynamic-import from an e2e spec is also safe.

import { installParamPrim } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installParamPrim(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installParamPrim;
