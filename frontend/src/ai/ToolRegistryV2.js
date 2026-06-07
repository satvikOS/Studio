/**
 * ArchDisc Studio — AI Tool Registry V2 (auto-introspected, slice 787).
 *
 * The V1 `ToolRegistry.js` (slice 184) is a HAND-MAINTAINED catalogue of
 * the ribbon actions, primitives, property knobs, and entry-point fns
 * shipped through slice ~280. Since then, slices 745-786 (and roughly
 * 130 modules before that) have piled ~700 new `__studio*` ops onto
 * `window` via the V3 `registerOps` chain (see
 * `frontend/src/workbenches/studio/v3/common/registry.js`) — UV editor,
 * grooming, USD layers, MoGraph effectors, AutoCAD 2D drawing, SD noise
 * generators, Plasticity solid ops, Houdini POPs, etc. The V1 registry
 * was never updated; Archie can not discover those ops without walking
 * the runtime registry directly.
 *
 * This module is the AUTO-BUILT registry that fixes that gap. It walks
 * `window.__studioCommandRegistry` (the central Map V3 modules write
 * to via `__studioCommandRegister`) and exposes a stable JSON-safe
 * surface so Archie's planner / verifier / autonomous loop can read
 * every Studio op the runtime currently exposes, grouped by the
 * `category` each module passed to `registerOps`.
 *
 * It is purely INTROSPECTIVE — it does NOT register anything new on
 * `window`. The `installToolRegistryV2()` helper in
 * `index-installer.js` is the only place that wires window globals.
 *
 * Contract (same shape as V1 entries, plus a `fn` handle):
 *   - getToolList()        → [{name, category, description, paramSpec?}]
 *   - getToolByName(name)  → {name, category, description, fn} | null
 *   - getCategoryCounts()  → {sculpt:N, fx:M, …}
 *   - getRegistrySize()    → integer
 *   - getCategories()      → [string]
 *
 * The lookups are RE-EVALUATED on every call so a later-mounting module
 * (autoloaded from `api.js`) is picked up the next time Archie asks.
 * No caching, no stale snapshots.
 */

// ─── Internal registry walk ───────────────────────────────────────────
function _walkRegistry() {
  if (typeof window === 'undefined') return [];
  const reg = window.__studioCommandRegistry;
  if (!reg || typeof reg.values !== 'function') return [];
  const out = [];
  // The Map values carry {name, action, category, description, shortcut}.
  reg.forEach((entry) => {
    if (!entry || !entry.name) return;
    out.push({
      name: entry.name,
      category: entry.category || 'auto',
      description: entry.description || '',
      shortcut: entry.shortcut || '',
      fn: entry.action || null,
    });
  });
  return out;
}

// Strip the leading `__studio` prefix for prettier display + matching
// the V1 entry-point id convention (`fn:Foo` vs `__studioFoo`).
function _stripPrefix(name) {
  return String(name || '').replace(/^__studio/, '');
}

// Infer rough parameter types from the camel-cased op name. This is a
// HEURISTIC — used to give Archie a starting shape when no explicit
// paramSpec was registered (the registerOps API doesn't take one yet).
function _inferParamTypes(name) {
  const tail = _stripPrefix(name);
  const lower = tail.toLowerCase();
  const out = {};
  // Verb-noun pairs that map onto canonical args.
  if (/create|spawn|add|make|new/.test(lower)) out.opts = 'object';
  if (/step|tick|advance|update/.test(lower))  { out.key = 'string'; out.dt = 'number'; }
  if (/list|enumerate|get/.test(lower))        out.filter = 'object?';
  if (/remove|delete|drop|clear/.test(lower))  out.key = 'string';
  if (/set|apply|bake|paint|brush/.test(lower)) out.params = 'object';
  if (/select|pick|frame/.test(lower))         out.target = 'mesh|uuid';
  if (/import|load|export|save/.test(lower))   out.uri = 'string';
  if (/move|rotate|scale|mirror|transform/.test(lower)) out.transform = 'object';
  // Specific noun cues.
  if (/uv|island|seam|unwrap/.test(lower))     out.meshUuid = 'string';
  if (/material|texture|preset|shader/.test(lower)) out.name = 'string';
  if (/force|emitter|particle|pop|niagara/.test(lower)) out.key = 'string';
  if (/mesh|geom|prim/.test(lower) && !out.meshUuid) out.meshUuid = 'string?';
  return out;
}

// ─── Public API ───────────────────────────────────────────────────────

/**
 * Get the flat list of every tool the runtime registry currently
 * exposes. Each entry includes a name, category, one-line description,
 * and (heuristic) paramSpec for Archie's planner prompt.
 */
export function getToolList() {
  return _walkRegistry().map((e) => ({
    name: e.name,
    category: e.category,
    description: e.description,
    paramSpec: _inferParamTypes(e.name),
  }));
}

/**
 * Fetch a single tool by its `__studio*` name. Returns the live entry
 * (including the callable `fn` handle) or null.
 */
export function getToolByName(name) {
  if (!name) return null;
  const entries = _walkRegistry();
  return entries.find((e) => e.name === name) || null;
}

/**
 * Per-category counts ({sculpt: 12, fx: 8, …}).
 * Useful for parity diagnostics + Archie's prompt budget control.
 */
export function getCategoryCounts() {
  const counts = {};
  for (const e of _walkRegistry()) {
    counts[e.category] = (counts[e.category] || 0) + 1;
  }
  return counts;
}

/** Total number of registered tools. */
export function getRegistrySize() {
  return _walkRegistry().length;
}

/** Sorted list of every distinct category present. */
export function getCategories() {
  return Object.keys(getCategoryCounts()).sort();
}

/** Tools filtered to a single category. */
export function getToolsByCategory(category) {
  const cat = String(category || '');
  return getToolList().filter((t) => t.category === cat);
}

/** Free-text name+description match. Case-insensitive. */
export function findTools(query) {
  const q = String(query || '').toLowerCase().trim();
  if (!q) return getToolList();
  return getToolList().filter(
    (t) => t.name.toLowerCase().includes(q)
        || t.description.toLowerCase().includes(q),
  );
}

export default {
  getToolList,
  getToolByName,
  getCategoryCounts,
  getRegistrySize,
  getCategories,
  getToolsByCategory,
  findTools,
};
