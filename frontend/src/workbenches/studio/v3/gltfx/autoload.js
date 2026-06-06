// ArchDisc Studio V3 — glTF KHR-extension polish autoloader (slice 768).
//
// Side-effect installer. Mirrors usdlayer/autoload.js: defers
// `installGLTFX()` one microtask so `registerV3Api()` has populated
// `window.__studioCommandRegister` before the ops register. The
// `registerOps` helper retries anyway, but the microtask gate keeps the
// happy path zero-retry.
//
// e2e specs can also import directly off the Vite dev server:
//   await import('/src/workbenches/studio/v3/gltfx/autoload.js');

import { installGLTFX } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installGLTFX(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installGLTFX;
