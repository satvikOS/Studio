/**
 * ArchDisc Studio — Planner.
 *
 * Turns a user prompt + clarification answers into either:
 *   - a STEP-ARRAY plan against ToolRegistry (run by PlanExecutor), or
 *   - a STUDIO RECIPE {goal, scene, bodies, expect} (run by Archie's
 *     loop in WorkbenchStudio).
 *
 * Both are valid output shapes. The LLM is asked for whichever is most
 * appropriate for the prompt; the planner detects which shape came
 * back. A connected provider (cloud or local SLM) is optional — when
 * absent, the planner returns the matching Studio fallback recipe so
 * the loop keeps running fully offline.
 */

import { TOOL_REGISTRY, ALL_TOOL_IDS, findTool } from './ToolRegistry.js';
import { PROVIDERS } from './PlannerProviders.js';

// ─── STUDIO FALLBACK RECIPES (offline-safe) ──────────────────────────
// Same data-driven shape Archie's loop already accepts. Reusable as
// few-shot exemplars for the LLM, and as the no-provider fallback.
export const STUDIO_FALLBACK_RECIPES = {
  modeling: {
    goal: 'starter scene',
    scene: { discipline: 'modeling', engine: 'engine-eevee' },
    bodies: [
      { kind: 'cube',   pos: [-0.05, 0, 0], scale: [1, 1, 1], color: '#8aa1c9' },
      { kind: 'sphere', pos: [ 0.05, 0, 0], scale: [1, 1, 1], color: '#cf8d8d' },
    ],
    expect: { bodies: 2, kinds: ['cube', 'sphere'] },
  },
  sculpting: {
    goal: 'sculpted boulder',
    scene: { discipline: 'sculpting' },
    bodies: [
      { kind: 'icosahedron', pos: [0, 0, 0], scale: [1.6, 1.2, 1.6],
        color: '#7a6e60', ops: ['sculpt-erode', 'sculpt-weather'] },
    ],
    expect: { bodies: 1, kinds: ['icosahedron'] },
  },
  rendering: {
    goal: 'lit hero shot',
    scene: { discipline: 'rendering', engine: 'engine-eevee',
      lights: [
        { type: 'light-point', color: '#ffe6c0', intensity: 0.18 },
        { type: 'light-sun',   color: '#ffffff', intensity: 0.20 },
      ],
      comp: ['pp-tone-map', 'pp-auto-exposure', 'comp-bloom'],
    },
    bodies: [
      { kind: 'teapot', pos: [0, 0, 0], scale: [1, 1, 1],
        color: '#bfa14a',
        material: { metalness: 0.9, roughness: 0.25 } },
      { kind: 'plane', pos: [0, -0.04, 0], scale: [3, 0.01, 3], color: '#2a2a2a' },
    ],
    expect: { bodies: 2, kinds: ['plane', 'teapot'] },
  },
  animation: {
    goal: 'spinning trio',
    scene: { discipline: 'animation' },
    bodies: [
      { kind: 'torus-knot', pos: [-0.08, 0, 0], scale: [0.9, 0.9, 0.9], color: '#9ab' },
      { kind: 'icosahedron', pos: [ 0,    0, 0], scale: [0.9, 0.9, 0.9], color: '#c9a' },
      { kind: 'dodecahedron', pos: [ 0.08, 0, 0], scale: [0.9, 0.9, 0.9], color: '#ac9' },
    ],
    expect: { bodies: 3, kinds: ['dodecahedron', 'icosahedron', 'torus-knot'] },
  },
  generic: {
    goal: 'two-primitive sanity scene',
    scene: { discipline: 'modeling' },
    bodies: [
      { kind: 'cube',   pos: [-0.05, 0, 0], scale: [1, 1, 1], color: '#aaa' },
      { kind: 'sphere', pos: [ 0.05, 0, 0], scale: [1, 1, 1], color: '#aaa' },
    ],
    expect: { bodies: 2, kinds: ['cube', 'sphere'] },
  },
};

// ─── SYSTEM PROMPT — Studio-flavored ─────────────────────────────────
export const SYSTEM_PROMPT = [
  'You are ArchDisc Studio\'s autonomous 3D-content planner. Studio is a',
  'Blender / Maya / Houdini / ZBrush-class desktop app driven by AI plans.',
  '',
  'Your job: take a user prompt + any clarification answers and emit ONE',
  'JSON object describing how Studio should build the scene. Output ONE of:',
  '',
  '  (A) {"recipe": {"goal":..., "scene":{...}, "bodies":[...], "expect":{...}}}',
  '      — high-level data-driven scene recipe (preferred for build-a-scene',
  '        prompts). bodies[i] has {kind, pos:[x,y,z], scale:[x,y,z],',
  '        rot:[x,y,z]?, color?, emissive?, material?{}, sculpt?{}, brush?{},',
  '        ops:[ribbon-action-id, ...]?, mods:[{name,params}], array?{},',
  '        scatter?{}, texture?{}}. scene has {discipline, engine, world,',
  '        lights:[{type,color,intensity}], comp:[ribbon-action-id, ...],',
  '        ops:[ribbon-action-id, ...]}. expect has {bodies, kinds:[...]}.',
  '',
  '  (B) {"plan": [{"tool":"<id>", "comment":"<why>", "params":{...}}, ...]}',
  '      — low-level step array against the tool registry below.',
  '',
  'Use (A) for "build / make / create a scene" prompts.',
  'Use (B) for "execute these specific tools in order" prompts.',
  '',
  'All tool ids and primitive kinds MUST come from the registry below.',
  'Keep plans tight (4-20 steps) and recipes lean (1-12 bodies).',
  '',
  'Studio Tool Registry (id :: discipline / category — description):',
].join('\n');

/** Render the registry as a deterministic string for the prompt. */
export function registryContextBlock() {
  return TOOL_REGISTRY
    .map((t) => `${t.id} :: ${t.discipline}/${t.category} — ${t.description}`)
    .join('\n');
}

/** Build the user-message that's appended to the system prompt. */
export function buildUserMessage(userPrompt, clarifications) {
  const lines = [`Goal: ${userPrompt}`];
  if (clarifications && Object.keys(clarifications).length) {
    lines.push('', 'Clarifications:');
    for (const [k, v] of Object.entries(clarifications)) lines.push(`  - ${k}: ${v}`);
  }
  lines.push('', 'Return JSON only.');
  return lines.join('\n');
}

// ─── PARSING + VALIDATION ────────────────────────────────────────────
/** Pull a JSON object out of LLM text (markdown fences, prose, etc.). */
export function parseLLMJson(text) {
  if (!text || typeof text !== 'string') return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('{'); const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(body.slice(start, end + 1)); } catch { return null; }
}

/** Validate a step-array plan. Returns {ok, errors, warnings, normalized}. */
export function validateAndNormalizePlan(raw) {
  const errors = [], warnings = [];
  if (!Array.isArray(raw)) {
    return { ok: false, errors: ['plan is not an array'], warnings, normalized: null };
  }
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i];
    if (!s || typeof s !== 'object' || typeof s.tool !== 'string') {
      errors.push(`step ${i}: missing/non-string 'tool'`); continue;
    }
    if (!findTool(s.tool)) { errors.push(`step ${i}: unknown tool "${s.tool}"`); continue; }
    out.push({
      tool: s.tool,
      comment: typeof s.comment === 'string' ? s.comment : '',
      ...(s.params && typeof s.params === 'object' ? { params: s.params } : {}),
    });
  }
  return { ok: errors.length === 0, errors, warnings, normalized: errors.length ? null : out };
}

/** Validate a Studio recipe. Returns {ok, errors, normalized}. */
export function validateAndNormalizeRecipe(raw) {
  const errors = [], warnings = [];
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errors: ['recipe is not an object'], normalized: null };
  }
  const out = {
    goal: typeof raw.goal === 'string' ? raw.goal : 'untitled',
    scene: (raw.scene && typeof raw.scene === 'object') ? { ...raw.scene } : {},
    bodies: [],
    expect: { ...(raw.expect || {}) },
  };
  if (raw.reference) out.reference = raw.reference;
  if (raw.view) out.view = raw.view;
  if (Array.isArray(raw.bodies)) {
    for (let i = 0; i < raw.bodies.length; i++) {
      const b = raw.bodies[i];
      if (!b || typeof b !== 'object' || typeof b.kind !== 'string') {
        errors.push(`body ${i}: missing 'kind'`); continue;
      }
      const meta = findTool(b.kind);
      if (!meta || (meta.kind !== 'primitive' && meta.kind !== 'primitive-special')) {
        warnings.push(`body ${i}: kind '${b.kind}' is not a known primitive`);
      }
      out.bodies.push({ ...b });
    }
  }
  return { ok: errors.length === 0, errors, warnings, normalized: errors.length ? null : out };
}

// ─── PUBLIC ENTRY POINT ──────────────────────────────────────────────
/**
 * @param {object} args
 * @param {string} args.userPrompt
 * @param {object} [args.clarifications]
 * @param {string} [args.domain]              modeling | sculpting | rendering | animation | generic
 * @param {object} [args.providerCfg]         {provider, apiKey, model, baseUrl}
 * @param {object} [args.providerOverride]    test/inject
 * @param {function} [args.onToken]           streaming callback
 * @returns {{source, recipe?, plan?, errors?, warnings?}}
 *   source ∈ {'llm', 'llm-streamed', 'fallback-recipe', 'fallback-error'}
 */
export async function planFor({
  userPrompt, clarifications,
  domain = 'generic', providerCfg, providerOverride, onToken,
}) {
  const fallback = STUDIO_FALLBACK_RECIPES[domain] || STUDIO_FALLBACK_RECIPES.generic;
  const cfg = providerCfg ?? null;
  const provider = providerOverride ?? (cfg && PROVIDERS[cfg.provider]);
  if (!provider) return { source: 'fallback-recipe', recipe: deepClone(fallback) };

  try {
    const system = `${SYSTEM_PROMPT}\n${registryContextBlock()}`;
    const userMessage = buildUserMessage(userPrompt, clarifications);
    const args = { apiKey: cfg?.apiKey, model: cfg?.model, baseUrl: cfg?.baseUrl, system, userMessage };
    const streamed = !!onToken && typeof provider.generateStream === 'function';
    const text = streamed
      ? await provider.generateStream({ ...args, onToken })
      : await provider.generate(args);
    const obj = parseLLMJson(text);
    if (!obj) {
      return { source: 'fallback-error', recipe: deepClone(fallback),
        errors: ['could not parse JSON from LLM output'] };
    }
    if (obj.recipe) {
      const { ok, errors, warnings, normalized } = validateAndNormalizeRecipe(obj.recipe);
      if (!ok) return { source: 'fallback-error', recipe: deepClone(fallback), errors };
      return { source: streamed ? 'llm-streamed' : 'llm', recipe: normalized, warnings };
    }
    if (Array.isArray(obj.plan)) {
      const { ok, errors, warnings, normalized } = validateAndNormalizePlan(obj.plan);
      if (!ok) return { source: 'fallback-error', recipe: deepClone(fallback), errors };
      return { source: streamed ? 'llm-streamed' : 'llm', plan: normalized, warnings };
    }
    return { source: 'fallback-error', recipe: deepClone(fallback),
      errors: ['LLM JSON had neither "recipe" nor "plan"'] };
  } catch (err) {
    return { source: 'fallback-error', recipe: deepClone(fallback), errors: [err.message] };
  }
}

function deepClone(x) { return JSON.parse(JSON.stringify(x)); }

export { ALL_TOOL_IDS };
