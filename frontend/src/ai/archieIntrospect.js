/**
 * ArchDisc Studio — Archie introspection manifest (slice 787).
 *
 * `buildArchieToolManifest()` walks the live command registrar (the same
 * `window.__studioCommandRegistry` Map the V3 `registerOps` chain
 * writes to) and emits a JSON-SERIALISABLE manifest of every Studio op
 * GROUPED BY CATEGORY. The manifest is the canonical artefact Archie's
 * planner / verifier / autonomous loop consume — they need a stable
 * pure-JSON object they can stringify into a prompt, hash for cache
 * keys, or ship across the e2e boundary to verify parity.
 *
 * Shape:
 * {
 *   builtAt: <epoch ms>,
 *   total: <int>,
 *   categories: {
 *     sculpt: {
 *       count: <int>,
 *       tools: [
 *         { name, category, description, paramTypes },
 *         ...
 *       ],
 *     },
 *     fx: { ... },
 *     rig: { ... },
 *     ...
 *   },
 * }
 *
 * Each tool entry's `paramTypes` is INFERRED FROM THE NAME (the
 * registerOps API doesn't take an explicit param schema yet). The
 * inference rules mirror `ToolRegistryV2._inferParamTypes` so the two
 * surfaces stay in sync.
 *
 * Pure JSON in / pure JSON out. NO callable references. NO `window`
 * access at module load — only at call time, so the unit/build path
 * doesn't choke on SSR-style cold starts.
 */

import {
  getToolList,
  getRegistrySize,
} from './ToolRegistryV2.js';

// Mirror ToolRegistryV2's inference (kept inline so this file is
// callable without the V2 surface, e.g. from a build-time script).
function _inferParamTypes(name) {
  const lower = String(name || '').replace(/^__studio/, '').toLowerCase();
  const out = {};
  if (/create|spawn|add|make|new/.test(lower))   out.opts = 'object';
  if (/step|tick|advance|update/.test(lower))    { out.key = 'string'; out.dt = 'number'; }
  if (/list|enumerate|get/.test(lower))          out.filter = 'object?';
  if (/remove|delete|drop|clear/.test(lower))    out.key = 'string';
  if (/set|apply|bake|paint|brush/.test(lower))  out.params = 'object';
  if (/select|pick|frame/.test(lower))           out.target = 'mesh|uuid';
  if (/import|load|export|save/.test(lower))     out.uri = 'string';
  if (/move|rotate|scale|mirror|transform/.test(lower)) out.transform = 'object';
  if (/uv|island|seam|unwrap/.test(lower))       out.meshUuid = 'string';
  if (/material|texture|preset|shader/.test(lower)) out.name = 'string';
  if (/force|emitter|particle|pop|niagara/.test(lower)) out.key = 'string';
  if (/mesh|geom|prim/.test(lower) && !out.meshUuid) out.meshUuid = 'string?';
  return out;
}

/**
 * Build the manifest by walking `window.__studioCommandRegistry`.
 * Returns a JSON-serialisable object. If the registry hasn't mounted
 * yet (no V3 shell), returns an empty `{ builtAt, total:0, categories:{} }`.
 */
export function buildArchieToolManifest() {
  const tools = getToolList();
  const categories = {};
  for (const t of tools) {
    const cat = t.category || 'auto';
    if (!categories[cat]) categories[cat] = { count: 0, tools: [] };
    categories[cat].count += 1;
    categories[cat].tools.push({
      name: t.name,
      category: cat,
      description: t.description || '',
      paramTypes: _inferParamTypes(t.name),
    });
  }
  // Deterministic alphabetical sort inside each category so manifests
  // hash-stably across reloads.
  for (const cat of Object.keys(categories)) {
    categories[cat].tools.sort((a, b) => a.name.localeCompare(b.name));
  }
  return {
    builtAt: Date.now(),
    total: tools.length,
    categories,
  };
}

/**
 * Top-N per category, the format Archie's planner prompt actually
 * consumes (full manifests can run >700 tools). Keeps the prompt token
 * bill bounded.
 */
export function buildArchieToolManifestTopN(perCategoryLimit) {
  const lim = Math.max(1, Math.min(200, Number(perCategoryLimit) || 50));
  const full = buildArchieToolManifest();
  const out = { builtAt: full.builtAt, total: 0, categories: {} };
  for (const cat of Object.keys(full.categories)) {
    const tools = full.categories[cat].tools.slice(0, lim);
    out.categories[cat] = {
      count: full.categories[cat].count,   // ORIGINAL count, not truncated
      tools,
    };
    out.total += tools.length;
  }
  return out;
}

/**
 * Diagnostic snapshot — just the counts, no tool entries. Used by the
 * status bar / autosave preamble so Archie can report registry health
 * without paying for the full walk.
 */
export function snapshotArchieRegistry() {
  const tools = getToolList();
  const counts = {};
  for (const t of tools) {
    const cat = t.category || 'auto';
    counts[cat] = (counts[cat] || 0) + 1;
  }
  return {
    builtAt: Date.now(),
    total: tools.length,
    registrySize: getRegistrySize(),
    categories: counts,
  };
}

export default {
  buildArchieToolManifest,
  buildArchieToolManifestTopN,
  snapshotArchieRegistry,
};
