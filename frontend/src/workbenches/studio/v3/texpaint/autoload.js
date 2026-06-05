// ArchDisc Studio V3 — texpaint autoload entry.
//
// Side-effect import installs the texpaint op surface + panel. The
// orchestrator wires `import('./texpaint/autoload.js')` from api.js;
// this file deliberately keeps the install behind a microtask so the
// V3 command registry is live before we try to enrich it with the
// 'texpaint' category.

import { installTexPaint } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installTexPaint(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installTexPaint;
