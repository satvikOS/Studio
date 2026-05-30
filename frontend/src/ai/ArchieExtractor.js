/**
 * ArchDisc Studio — Archie response extractor.
 *
 * Salvages partially-formed Archie LoRA responses into Studio recipes.
 *
 * Why it exists: the Archie LoRAs (DeepSeek-R1-Distill-Qwen-7B + per-
 * discipline adapters) sometimes emit the plan JSON inside a `<think>`
 * block and never close it, never follow up with `<tool_call>` blocks.
 * The plan JSON itself is usually valid and contains everything the
 * Planner needs — we just need to extract it and convert to either:
 *   - a Studio recipe {goal, scene, bodies, expect} (preferred), or
 *   - a STEP-ARRAY plan that PlanExecutor can dispatch.
 *
 * This file is the runtime counterpart to
 * ~/archdisc-Models/scripts/extract_tool_calls.mjs — keep them in sync.
 */

import { findTool } from './ToolRegistry.js';

const PLAN_RE = /<plan>([\s\S]*?)<\/plan>/i;
const TOOL_CALL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/gi;
const CLARIFY_RE = /<clarify>([\s\S]*?)<\/clarify>/i;

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

/** Extract a plan JSON object from anywhere in the assistant turn. */
export function extractPlan(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(PLAN_RE);
  if (m) {
    const obj = safeJsonParse(m[1].trim());
    if (obj && typeof obj === 'object') return obj;
  }
  // Fallback: find any {"goal": ...} JSON object via brace-matching
  const start = text.indexOf('{"goal"');
  if (start >= 0) {
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === '{') depth++;
      else if (text[i] === '}') {
        depth--;
        if (depth === 0) {
          const obj = safeJsonParse(text.slice(start, i + 1));
          if (obj) return obj;
        }
      }
    }
  }
  return null;
}

/** Pull literal <tool_call>{json}</tool_call> blocks from the text. */
export function extractToolCallsLiteral(text) {
  if (!text || typeof text !== 'string') return [];
  const out = [];
  for (const m of text.matchAll(TOOL_CALL_RE)) {
    const o = safeJsonParse(m[1].trim());
    if (o && o.name) out.push(o);
  }
  return out;
}

/** Extract a clarify block if present. */
export function extractClarify(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(CLARIFY_RE);
  if (!m) return null;
  return safeJsonParse(m[1].trim());
}

/**
 * Convert a plan's bodies + material to a recipe (the shape Archie's
 * loop already accepts in WorkbenchStudio). Each body becomes one
 * recipe.body with its primitive kind, optional ops, and optional material.
 */
export function planToRecipe(plan, discipline) {
  if (!plan) return null;
  const bodies = (Array.isArray(plan.bodies) ? plan.bodies : []).map((b, i) => {
    const kind = b.kind ?? b.prim ?? b.primitive;
    const out = { kind: kind || 'cube', pos: b.pos || [0, 0, 0], scale: b.scale || [1, 1, 1] };
    if (b.color) out.color = b.color;
    if (Array.isArray(b.ops)) out.ops = b.ops.slice();
    if (b.material && typeof b.material === 'object') {
      out.material = { ...b.material };
    }
    if (b.count || b.instances) {
      out.count = b.count || b.instances?.count || b.instances;
    }
    return out;
  });
  return {
    goal: plan.goal || 'archie extracted',
    scene: {
      discipline: discipline || plan.scene?.discipline || 'modeling',
      ...(typeof plan.scene === 'object' ? plan.scene : {}),
    },
    bodies,
    expect: plan.expect || {},
  };
}

const PATTERN_TOOL_IDS = ['apply-array', 'mograph-cloner', 'gn-distribute', 'gn-instance'];

/**
 * Synthesize STEP-ARRAY plan steps from a plan's bodies. Each body
 * spawns: click-discipline preamble (once), click-primitive,
 * set-selection scale-*, click-action per op, set-param material.*,
 * set-param array.count + apply-array if count > 1.
 */
export function synthesizeStepArrayFromPlan(plan, discipline) {
  if (!plan) return [];
  const steps = [];
  const disc = discipline || plan.scene?.discipline || 'modeling';
  steps.push({ tool: `discipline:${disc}`, comment: 'switch discipline' });

  for (const body of (Array.isArray(plan.bodies) ? plan.bodies : [])) {
    const kind = body.kind ?? body.prim ?? body.primitive;
    if (!kind || !findTool(kind)) continue;
    steps.push({ tool: kind, comment: body.id ? `spawn ${body.id}` : 'spawn primitive' });

    if (Array.isArray(body.scale)) {
      const [sx, sy, sz] = body.scale;
      if (sx > 0) steps.push({ tool: 'selection:scale-x', params: { value: sx } });
      if (sy > 0) steps.push({ tool: 'selection:scale-y', params: { value: sy } });
      if (sz > 0) steps.push({ tool: 'selection:scale-z', params: { value: sz } });
    }
    if (Array.isArray(body.ops)) {
      for (const op of body.ops) if (findTool(op)) steps.push({ tool: op });
    }

    const count = body.count || body.instances?.count;
    if (typeof count === 'number' && count > 1) {
      steps.push({ tool: 'array:count', params: { value: count } });
      const patternTool = body.instances?.kind || 'apply-array';
      if (findTool(patternTool)) steps.push({ tool: patternTool });
    }

    const mat = body.material || {};
    if (typeof mat.color === 'string') steps.push({ tool: 'material:color', params: { value: mat.color } });
    if (typeof mat.metalness === 'number' && mat.metalness >= 0 && mat.metalness <= 1) {
      steps.push({ tool: 'material:metalness', params: { value: mat.metalness } });
    }
    if (typeof mat.roughness === 'number' && mat.roughness >= 0 && mat.roughness <= 1) {
      steps.push({ tool: 'material:roughness', params: { value: mat.roughness } });
    }
  }
  return steps;
}

/**
 * Top-level entry: take an Archie raw assistant turn and return
 * { recipe?, plan?, clarify?, source } where source ∈
 *   { 'archie-literal', 'archie-synthesized', 'archie-clarify',
 *     'archie-none' }.
 *
 * Prefers literal tool_calls when present, falls back to plan-based
 * synthesis, finally returns clarify if that's the response shape.
 */
export function extractArchieResponse(text, { discipline } = {}) {
  const clarify = extractClarify(text);
  if (clarify) return { clarify, source: 'archie-clarify' };

  const plan = extractPlan(text);
  const literal = extractToolCallsLiteral(text);

  if (plan && literal.length > 0) {
    // Model gave us both — prefer literal tool_calls + recipe view of plan.
    return {
      recipe: planToRecipe(plan, discipline),
      plan: synthesizeStepArrayFromPlan(plan, discipline), // dual-form
      toolCalls: literal,
      source: 'archie-literal',
    };
  }
  if (plan) {
    return {
      recipe: planToRecipe(plan, discipline),
      plan: synthesizeStepArrayFromPlan(plan, discipline),
      source: 'archie-synthesized',
    };
  }
  return { source: 'archie-none' };
}

// ─── Window exposure for e2e + browser debugging ────────────────────
// Mirrors the rest of Studio's `window.__studio*` / `window.__archie*`
// hooks so headed Mac-Electron tests can poke the extractor without
// having to import modules from page context.
if (typeof window !== 'undefined') {
  window.__archieExtract = extractArchieResponse;
  window.__archieExtractor = {
    extractArchieResponse, extractPlan, extractToolCallsLiteral,
    extractClarify, planToRecipe, synthesizeStepArrayFromPlan,
  };
}
