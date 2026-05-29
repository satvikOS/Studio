/**
 * ArchDisc Studio — Verifier.
 *
 * Reads the live Studio scene back and reports what's actually there
 * so the planner / Archie's critique can grade the build. The Mech-era
 * physics-bounds verifier (Brayton thrust, blade-cooling temperature,
 * etc.) is gone — Studio's verifier is scene-shaped:
 *
 *   - bodies            count of meshes carrying archdiscStudioPrimitive
 *   - kinds             sorted unique primitive-kind set
 *   - opsApplied        per-mesh op-stamp counters
 *   - lightCount        scene lights tagged with archdiscStudioLight
 *   - reference         { active, url? } from __studioReferenceState (if any)
 *
 * verifyPlan() also flags missing expectations from a Studio recipe.
 */

/** Read the scene state. Safe to call with no scene (e.g. server-side). */
export function readSceneState() {
  if (typeof window === 'undefined') return emptyState();
  const scene = window.__archdiscScene;
  if (!scene) return emptyState();
  const kinds = new Set();
  const ops = {};
  let bodies = 0, lightCount = 0;
  scene.traverse((o) => {
    if (!o) return;
    if (o.userData && o.userData.archdiscStudioPrimitive) {
      bodies++;
      const k = String(o.userData.archdiscStudioPrimitiveKind || '').replace('-array', '');
      if (k) kinds.add(k);
      for (const [key, v] of Object.entries(o.userData)) {
        if (key.startsWith('archdiscStudio') && typeof v === 'number' && v > 0
            && key !== 'archdiscStudioPrimitive') {
          ops[key] = (ops[key] || 0) + v;
        }
      }
    }
    if (o.userData && o.userData.archdiscStudioLight) lightCount++;
  });
  const reference = (typeof window.__studioReferenceState === 'function')
    ? safeCall(window.__studioReferenceState) : null;
  return {
    bodies, kinds: [...kinds].sort(), opsApplied: ops, lightCount, reference,
  };
}

/** Compare scene state to a recipe's expectations.
 *  Returns {ok, violations:[{kind, expected, actual, severity}]}. */
export function verifyPlan(recipe, state) {
  const violations = [];
  state = state || readSceneState();
  const exp = (recipe && recipe.expect) || {};
  if (typeof exp.bodies === 'number' && state.bodies < exp.bodies) {
    violations.push({
      kind: 'bodies', expected: exp.bodies, actual: state.bodies,
      severity: 'error',
    });
  }
  if (Array.isArray(exp.kinds) && exp.kinds.length) {
    const got = new Set(state.kinds);
    const missing = exp.kinds.filter((k) => !got.has(k));
    if (missing.length) {
      violations.push({
        kind: 'kinds', expected: exp.kinds, actual: state.kinds,
        missing, severity: 'error',
      });
    }
  }
  if (typeof exp.lights === 'number' && state.lightCount < exp.lights) {
    violations.push({
      kind: 'lights', expected: exp.lights, actual: state.lightCount,
      severity: 'warn',
    });
  }
  if (Array.isArray(exp.opsApplied) && exp.opsApplied.length) {
    for (const opKey of exp.opsApplied) {
      if (!(state.opsApplied[opKey] > 0)) {
        violations.push({
          kind: 'opsApplied', expected: opKey, actual: 0, severity: 'warn',
        });
      }
    }
  }
  return { ok: violations.filter((v) => v.severity === 'error').length === 0, violations };
}

function emptyState() {
  return { bodies: 0, kinds: [], opsApplied: {}, lightCount: 0, reference: null };
}
function safeCall(fn) { try { return fn(); } catch { return null; } }
