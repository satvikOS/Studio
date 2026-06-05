// ArchDisc Studio V3 — EEVEE viewport-pass autoload entry.
//
// Side-effect installer matching rt/autoload.js + rtgpu/autoload.js +
// shader/autoload.js. Either api.js wires `import('./eevee/autoload.js')`
// (preferred) or an e2e spec dynamic-imports this URL directly to
// bootstrap the op surface before api.js has been touched.
//
// We defer one microtask so the install lands after registerV3Api()
// has populated the command registry; our installer enriches it with
// category 'rt' entries (sitting alongside the slice-684 CPU tracer and
// slice-693 GPU tracer).

import { installEevee } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installEevee(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installEevee;
