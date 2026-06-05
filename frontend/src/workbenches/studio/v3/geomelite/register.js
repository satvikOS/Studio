// Slice 697 — Register the 25 geomelite kinds with the slice-684
// geomnodes editor if it exposes a registrar; always populate the
// __studioGeomEliteNodes fallback map + __studioGeomEliteApply.

import { GEOM_ELITE_NODES } from './morenodes.js';

let _registered = false;

export function registerAll() {
  if (_registered) return;
  _registered = true;

  if (typeof window.__studioGeomRegisterNode === 'function') {
    for (const [kind, def] of Object.entries(GEOM_ELITE_NODES)) {
      try { window.__studioGeomRegisterNode(kind, def); } catch (_) {}
    }
  }
  window.__studioGeomEliteNodes = GEOM_ELITE_NODES;
  window.__studioGeomEliteApply = (kind, params, inputs) => {
    const def = GEOM_ELITE_NODES[kind];
    if (!def) return { ok: false, error: 'unknown kind' };
    try {
      const r = def.eval(params || {}, inputs || []);
      return { ok: true, result: r };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  };
  window.__studioGeomEliteList = () => ({
    ok: true,
    count: Object.keys(GEOM_ELITE_NODES).length,
    kinds: Object.keys(GEOM_ELITE_NODES),
  });
}
