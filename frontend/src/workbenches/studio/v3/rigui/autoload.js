// ArchDisc Studio V3 — rig UI autoloader.
//
// Side-effect installer mirroring v3/rt/autoload.js + v3/rig/autoload.js.
// Either api.js wires `import('./rigui/autoload.js')` (preferred long-term)
// or an e2e spec dynamic-imports this URL directly to bring the rig UI
// op surface up — both paths converge on installRigUI().
//
// We defer one microtask so the install lands after registerV3Api() has
// populated the command registry, which our installer then enriches with
// category 'rig' entries.

import { installRigUI } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installRigUI(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installRigUI;
