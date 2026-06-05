// ArchDisc Studio V3 — path tracer autoload entry.
//
// Side-effect installer mirroring v3/shader/autoload.js + v3/rig/autoload.js.
// Either api.js wires `import('./rt/autoload.js')` (preferred) or an e2e
// spec dynamic-imports this URL directly; both paths converge on a single
// installPathTracer() call.
//
// We defer one microtask so the install lands after registerV3Api() has
// populated the command registry, which our installer then enriches with
// category 'rt' entries.

import { installPathTracer } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installPathTracer(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installPathTracer;
