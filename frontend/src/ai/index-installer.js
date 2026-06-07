/**
 * ArchDisc Studio — Archie tool-registry installer (slice 787).
 *
 * Wires three window globals on top of the slice-787 introspection
 * surface so Archie (and any planner / verifier / e2e) can discover
 * every `__studio*` op the V3 shell currently registers WITHOUT having
 * to know the internal Map name.
 *
 *   window.__archieToolList()           — full flat list of tools
 *                                         (autobuilt; same shape as
 *                                          ToolRegistryV2.getToolList).
 *   window.__archieGetTool(name)        — fetch one tool by name.
 *   window.__archieGetCategories()      — sorted list of category strings.
 *   window.__archieToolManifest()       — JSON-serialisable manifest
 *                                         (archieIntrospect.buildArchieToolManifest).
 *   window.__archieToolCounts()         — per-category counts only.
 *
 * `installToolRegistryV2()` is IDEMPOTENT — calling it twice is safe;
 * it short-circuits on the second invocation.
 *
 * The autoload import in `v3/api.js` calls this once during V3 shell
 * boot, AFTER every parity-module autoload has run, so the registry
 * walk sees the full op set. The install itself does NOT need a
 * settled registry — every getter is lazy (rewalks on each call), so a
 * later-mounting module is picked up the next time Archie asks.
 *
 * Pure JS, no new deps.
 */

import {
  getToolList,
  getToolByName,
  getCategoryCounts,
  getRegistrySize,
  getCategories,
  getToolsByCategory,
  findTools,
} from './ToolRegistryV2.js';

import {
  buildArchieToolManifest,
  buildArchieToolManifestTopN,
  snapshotArchieRegistry,
} from './archieIntrospect.js';

let _installed = false;

export function installToolRegistryV2() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__archieToolRegistryV2Installed) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__archieToolRegistryV2Installed = true;

  // ─── Required brief surface ──────────────────────────────────────
  window.__archieToolList     = () => getToolList();
  window.__archieGetTool      = (name) => getToolByName(name);
  window.__archieGetCategories = () => getCategories();

  // ─── Bonus surface (counts + manifest + search) ──────────────────
  window.__archieToolCounts   = () => getCategoryCounts();
  window.__archieToolSize     = () => getRegistrySize();
  window.__archieToolsByCategory = (cat) => getToolsByCategory(cat);
  window.__archieFindTools    = (q) => findTools(q);

  window.__archieToolManifest = () => buildArchieToolManifest();
  window.__archieToolManifestTopN = (n) => buildArchieToolManifestTopN(n);
  window.__archieToolSnapshot = () => snapshotArchieRegistry();

  return {
    ok: true,
    alreadyInstalled: false,
    installedAt: Date.now(),
    apis: [
      '__archieToolList',
      '__archieGetTool',
      '__archieGetCategories',
      '__archieToolCounts',
      '__archieToolSize',
      '__archieToolsByCategory',
      '__archieFindTools',
      '__archieToolManifest',
      '__archieToolManifestTopN',
      '__archieToolSnapshot',
    ],
  };
}

export function uninstallToolRegistryV2() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  for (const k of [
    '__archieToolList',
    '__archieGetTool',
    '__archieGetCategories',
    '__archieToolCounts',
    '__archieToolSize',
    '__archieToolsByCategory',
    '__archieFindTools',
    '__archieToolManifest',
    '__archieToolManifestTopN',
    '__archieToolSnapshot',
  ]) {
    try { delete window[k]; } catch (_) {}
  }
  _installed = false;
  window.__archieToolRegistryV2Installed = false;
  return { ok: true };
}

// Auto-install on import — matches the existing `v3/<mod>/autoload.js`
// pattern (Promise.resolve().then(install)) so the V3 shell only has
// to `import('../../../ai/index-installer.js')` to wire everything.
if (typeof window !== 'undefined') {
  Promise.resolve().then(installToolRegistryV2);
}

export default installToolRegistryV2;
