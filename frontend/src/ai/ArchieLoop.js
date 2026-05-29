/*
 * Archie — ArchDisc Studio's autonomous, self-directed, self-improving,
 * non-stop agent loop, wired onto the AI scaffold (Planner / PlanExecutor /
 * Verifier / SessionMemory).
 *
 * The loop is EXECUTION-AGNOSTIC: the caller supplies execute()/verify()/
 * plan() so the exact same engine runs in-app (driving Studio's own build
 * functions) or under Playwright in e2e (driving the real desktop app). This
 * is why "all tests are done using in-house Archie" — a spec just boots
 * Studio and hands Archie a goal; Archie plans, builds, reads the result,
 * self-critiques, iterates, and banks a reusable skill.
 *
 * Archie's mandate: WORK NON-STOP UNTIL 1:1-OR-BETTER PARITY IS REACHED. It
 * does not give up on a goal at a mediocre score — it keeps refining and
 * rebuilding until the critique hits parity (score >= parityScore, default
 * 1.0), bounded only by a safety iteration cap (so tests still terminate) and
 * an external stop signal.
 *
 * Cycle per goal:
 *   plan (learned skill -> deterministic curriculum -> connected-model LLM)
 *   -> execute -> verify -> critique(score) -> if below parity: refine
 *   -> retry  (LOOP until parity or the safety cap) -> save/improve skill
 *   -> curate memory -> next goal.
 * Non-stop: when the goal queue empties and selfDirect is on, Archie spawns a
 * refinement of its best skill and keeps going.
 *
 * Archie is model-agnostic — the optional `plan` planner can call cloud
 * (API-key) or local (own-hardware) models via PlannerProviders; with no
 * provider it runs fully offline on the deterministic curriculum.
 */

// A data-driven Studio build plan is { goal, bodies:[{kind,pos,scale,color,
// rot,ops}], expect:{bodies,kinds} } — the same recipe shape the e2e builds
// use, so Archie has goals AND offline plans with no LLM key.
export const DEFAULT_CURRICULUM = [
  {
    goal: 'stone cairn',
    bodies: [
      { kind: 'cylinder', pos: [0, -0.02, 0], scale: [2.2, 0.4, 2.2], color: '#7c756a' },
      { kind: 'icosahedron', pos: [0, 0.0, 0], scale: [1.6, 1.2, 1.6], color: '#6f6a60', ops: ['sculpt-erode'] },
      { kind: 'icosahedron', pos: [0, 0.018, 0], scale: [1.1, 0.9, 1.1], color: '#787268', ops: ['sculpt-erode'] },
      { kind: 'icosahedron', pos: [0, 0.03, 0], scale: [0.7, 0.7, 0.7], color: '#827b70', ops: ['sculpt-erode'] },
    ],
    expect: { bodies: 4, kinds: ['cylinder', 'icosahedron'] },
  },
  {
    goal: 'ringed monolith',
    bodies: [
      { kind: 'cube', pos: [0, 0.0, 0], scale: [0.7, 3.0, 0.7], color: '#5b5650' },
      { kind: 'torus', pos: [0, 0.0, 0], scale: [1.6, 1.6, 0.5], color: '#caa14a', rot: [1.5708, 0, 0] },
      { kind: 'cylinder', pos: [0, -0.045, 0], scale: [2.4, 0.4, 2.4], color: '#6e6860' },
    ],
    expect: { bodies: 3, kinds: ['cube', 'cylinder', 'torus'] },
  },
  {
    goal: 'lantern post',
    bodies: [
      { kind: 'cylinder', pos: [0, -0.02, 0], scale: [0.4, 3.0, 0.4], color: '#3a3a40' },
      { kind: 'sphere', pos: [0, 0.04, 0], scale: [0.9, 0.9, 0.9], color: '#ffe39a', emissive: 1.6 },
      { kind: 'cone', pos: [0, 0.062, 0], scale: [1.0, 0.6, 1.0], color: '#2b2b30' },
    ],
    expect: { bodies: 3, kinds: ['cone', 'cylinder', 'sphere'] },
  },
];

export class ArchieSkillStore {
  constructor(initial = []) {
    this.skills = new Map();
    for (const s of initial) this.skills.set(s.goal, s);
  }
  find(goal) { return this.skills.get(goal) || null; }
  // Keep the highest-scoring recipe per goal; that is the "self-improving"
  // half of the loop — a better build for a known goal supersedes the old one.
  save(goal, plan, score) {
    const prev = this.skills.get(goal);
    if (!prev || score > prev.score) {
      this.skills.set(goal, { goal, plan, score, uses: (prev ? prev.uses : 0) + 1, updatedAt: Date.now() });
      return prev ? 'improved' : 'created';
    }
    prev.uses += 1;
    return 'reused';
  }
  best() { return [...this.skills.values()].sort((a, b) => b.score - a.score)[0] || null; }
  list() { return [...this.skills.values()]; }
}

// Deterministic planner: resolve a goal to a curriculum recipe (offline).
export function deterministicPlanner(goal, curriculum = DEFAULT_CURRICULUM) {
  const hit = curriculum.find((g) => g.goal === goal || goal.indexOf(g.goal) === 0);
  return hit ? JSON.parse(JSON.stringify(hit)) : null;
}

// Self-critique: score a verify result in [0,1] vs the plan's expectations.
// verifyResult = { bodies, kinds:[...] } read back from the scene.
export function critique(plan, verifyResult) {
  if (!plan || !verifyResult) return 0;
  const exp = plan.expect || {};
  let score = 0, parts = 0;
  if (typeof exp.bodies === 'number') {
    parts++;
    score += Math.min(1, (verifyResult.bodies || 0) / Math.max(1, exp.bodies));
  }
  if (Array.isArray(exp.kinds) && exp.kinds.length) {
    parts++;
    const got = new Set(verifyResult.kinds || []);
    const present = exp.kinds.filter((k) => got.has(k)).length;
    score += present / exp.kinds.length;
  }
  return parts ? score / parts : (verifyResult.bodies > 0 ? 1 : 0);
}

// Self-improvement within a goal: nudge the plan after a weak build (e.g. the
// last body failed to register — re-emit it). Conservative, deterministic.
export function refinePlan(plan, verifyResult) {
  const next = JSON.parse(JSON.stringify(plan));
  const exp = next.expect || {};
  if (typeof exp.bodies === 'number' && (verifyResult.bodies || 0) < exp.bodies && next.bodies && next.bodies.length) {
    // duplicate the final body slightly nudged — covers a dropped placement
    const last = JSON.parse(JSON.stringify(next.bodies[next.bodies.length - 1]));
    if (last.pos) last.pos = [last.pos[0], (last.pos[1] || 0) + 0.001, last.pos[2]];
    next.bodies.push(last);
    next._refined = (next._refined || 0) + 1;
  }
  return next;
}

/*
 * runArchieLoop — the non-stop engine.
 * opts:
 *   execute(plan)            async, builds the plan; returns anything
 *   verify(plan, result)     async, reads the scene -> { bodies, kinds }
 *   plan(goal)               optional async planner (LLM via connected models)
 *   skillStore               ArchieSkillStore (defaults to a fresh one)
 *   memory                   optional SessionMemory (record() called per goal)
 *   goals                    string[] (defaults to the curriculum)
 *   maxGoals, maxIterations, targetScore, selfDirect, onEvent, signal
 */
export async function runArchieLoop(opts = {}) {
  const {
    execute,
    verify,
    plan: llmPlanner = null,
    curriculum = DEFAULT_CURRICULUM,
    skillStore = new ArchieSkillStore(),
    memory = null,
    goals = curriculum.map((g) => g.goal),
    maxGoals = goals.length,
    // Archie keeps refining a goal until parity; this is only a SAFETY cap so
    // runs (and tests) terminate even if parity is unreachable.
    maxIterations = 8,
    parityScore = 1.0,   // 1:1 or better — Archie's non-stop target per goal
    selfDirect = false,
    onEvent = () => {},
    signal = { stopped: false },
  } = opts;

  if (typeof execute !== 'function' || typeof verify !== 'function') {
    throw new Error('runArchieLoop requires execute() and verify() callbacks');
  }

  const queue = [...goals];
  const log = [];
  let completed = 0, improvements = 0, reuses = 0;

  while (queue.length && completed < maxGoals && !signal.stopped) {
    const goal = queue.shift();
    onEvent({ type: 'goal-start', goal });

    // Plan: prefer a banked skill, else deterministic curriculum, else LLM.
    const learned = skillStore.find(goal);
    let plan = learned ? learned.plan : deterministicPlanner(goal, curriculum);
    let fromLLM = false;
    if (!plan && llmPlanner) { try { plan = await llmPlanner(goal); fromLLM = true; } catch (_) { plan = null; } }
    if (!plan) { onEvent({ type: 'no-plan', goal }); log.push({ goal, score: 0, verdict: 'no-plan' }); completed++; continue; }

    // Non-stop until 1:1-or-better parity (score >= parityScore), bounded by
    // the safety cap. Archie does NOT settle for a mediocre build.
    let best = { score: -1, plan };
    let reachedParity = false;
    for (let it = 0; it <= maxIterations && !signal.stopped; it++) {
      let result;
      try { result = await execute(plan); }
      catch (err) { onEvent({ type: 'execute-error', goal, iteration: it, error: String(err) }); break; }
      const v = await verify(plan, result);
      const score = critique(plan, v);
      onEvent({ type: 'iteration', goal, iteration: it, score, bodies: v && v.bodies });
      if (score > best.score) best = { score, plan: JSON.parse(JSON.stringify(plan)) };
      if (score >= parityScore) { reachedParity = true; break; }
      plan = refinePlan(plan, v); // self-improve within the goal, then retry
    }

    const verdict = skillStore.save(goal, best.plan, Math.max(0, best.score));
    if (verdict === 'improved' || verdict === 'created') improvements++;
    if (verdict === 'reused') reuses++;
    if (memory && typeof memory.record === 'function') {
      try { memory.record({ kind: 'archie-build', goal, score: best.score, fromLLM }); } catch (_) { /* memory is best-effort */ }
    }
    completed++;
    log.push({ goal, score: best.score, verdict, fromLLM, parity: reachedParity });
    onEvent({ type: 'goal-done', goal, score: best.score, verdict, parity: reachedParity });

    // Non-stop / self-directed: when the queue drains, refine the best skill
    // and keep working until maxGoals or a stop signal.
    if (selfDirect && !queue.length && completed < maxGoals) {
      const b = skillStore.best();
      if (b) { queue.push(b.goal); onEvent({ type: 'self-direct', goal: b.goal }); }
    }
  }

  return {
    completed, improvements, reuses,
    parityReached: log.filter((l) => l.parity).length,
    skills: skillStore.list(), log, stopped: signal.stopped,
  };
}
