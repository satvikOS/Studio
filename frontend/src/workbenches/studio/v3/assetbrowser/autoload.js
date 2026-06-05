// ArchDisc Studio V3 — Asset Browser autoload entry.
//
// Importing this module installs the asset browser into the V3 window
// surface. Designed for the api.js orchestrator wire-up:
//
//   import('./assetbrowser/autoload.js').catch(() => {});
//
// The install runs once per page-load. Re-imports are no-ops. The e2e
// spec dynamic-imports this file directly when api.js hasn't been
// wired yet, mirroring the matlib / shader / sculpt convention.

import { installAssetBrowser } from './index.js';

try {
  if (typeof window !== 'undefined') {
    // Defer one tick so the install lands after api.js's
    // registerV3Api() has populated __studioAssetSave + the command
    // registry, which we then enrich with category 'assetbrowser' entries.
    Promise.resolve().then(() => {
      try { installAssetBrowser(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export {};
