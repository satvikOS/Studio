// ArchDisc Studio V3 — HDA autoload entry.
//
// Importing this module installs the HDA bundle + the 15 new geometry
// node kinds into the V3 window surface. Deferred four micro-tasks so
// every preceding registry (api.js's __studioCommandRegister, slice-684
// geomnodes, slice-688 geomdeep, slice-693 geomtotal) is hot before
// we layer HDA on top.
//
// Re-imports are no-ops thanks to installHDA()'s _installed flag.

import { installHDA } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve()
      .then(() => Promise.resolve())
      .then(() => Promise.resolve())
      .then(() => Promise.resolve())
      .then(() => {
        try { installHDA(); } catch (_) { /* swallow */ }
      });
  }
} catch (_) { /* ignore */ }

export {};
