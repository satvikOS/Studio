// ArchDisc Studio V3 — audio system autoloader.
//
// Single-line installer used by tests + by anything that wants the
// __studioAudio* op surface lit up without orchestrating through
// api.js. Side-effect-import this module:
//
//   import('/src/workbenches/studio/v3/audio/autoload.js');
//
// Install is deferred one microtask so the command palette + animation
// system have had a chance to wire __studioCommandRegister and
// __studioPlayAnimation respectively. The pattern mirrors
// anim/autoload.js and shader/autoload.js so we get the same boot
// ordering semantics across the V3 add-on family.

import { installAudio } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installAudio(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installAudio;
