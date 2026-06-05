// ArchDisc Studio V3 — AutoPose autoload entry.
//
// Side-effect installer matching rig/autoload.js + eevee/autoload.js. An
// e2e spec dynamic-imports this URL to bootstrap the op surface before
// api.js's batched import block has been touched; once api.js is updated
// the spec's import becomes a no-op (installAutoPose is idempotent).
//
// We defer one microtask so the install lands AFTER registerV3Api() has
// populated window.__studioCommandRegister — the AutoPose installer
// registers under category 'rig' via the common registry, which gracefully
// queues if the register fn isn't ready yet, but the microtask hop keeps
// the cold-start path warning-free.

import { installAutoPose } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installAutoPose(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installAutoPose;
