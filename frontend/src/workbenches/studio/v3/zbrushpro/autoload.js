// ArchDisc Studio V3 — ZBrush Pro 50+ brush catalogue autoloader (slice 782).
//
// Mirrors `zbrushdetail/autoload.js`: a single-line side-effect installer
// that defers `installZBrushPro()` by one microtask so it lands after
// `registerV3Api()` has populated `window.__studioCommandRegister` and
// after the slice 758 zbrushdetail autoload has registered
// `__studioZBrushBrush`. The installer itself retries op registration on
// a short interval via `common/registry.js`, so registration is robust
// to cold-start ordering, but the BRUSH DELEGATION to slice 758 depends
// on `__studioZBrushBrush` being live by the time the first applyBrush
// call comes in — in practice it always is, because both autoloaders run
// in the same microtask queue and slice 758 is imported earlier in
// api.js.

import { installZBrushPro } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installZBrushPro(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installZBrushPro;
