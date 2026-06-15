// ArchDisc Studio V3 — GPU path tracer autoload entry.
//
// Side-effect installer matching rt/autoload.js + shader/autoload.js.
// Either api.js wires `import('./rtgpu/autoload.js')` (preferred) or an
// e2e spec dynamic-imports this URL directly to bootstrap the op
// surface before api.js has been touched.
//
// We defer one microtask so the install lands after registerV3Api()
// has populated the command registry; our installer enriches it with
// category 'rt' entries (sitting alongside the slice-684 CPU tracer).

import { installRTGPU } from './index.js';
// Side-effect import: registers window.__studioRunPathTracedOffscreenRender
// (headless clean hero-frame render — no editor chrome, no grid, framed on
// the part bounding box). Used by the demo harness / render queue.
import './offscreenRender.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installRTGPU(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installRTGPU;
