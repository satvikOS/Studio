// ArchDisc Studio V3 — Marvelous Designer multi-layer garment stack
// (slice 780). Multi-layer manager.
//
// Composes the cloth2 solver (slice 765) with the self-collision module
// (`selfCollision.js`) and the sewing module (`sewing.js`) to give a
// proper Marvelous Designer-style garment stack:
//
//   • Multiple cloth meshes coexist in one simulation handle (a "stack")
//   • Each cloth has a `layer` index — skin = 0 (deepest), undershirt =
//     1, shirt = 2, jacket = 3. Layer order matters for cross-collision:
//     deeper layers push outward; outer layers push inward.
//   • Cross-layer collision: every pair of adjacent layers gets a
//     `resolveCrossClothCollision` call after each integration step so
//     the shirt rests ON TOP of the skin instead of clipping through.
//   • Sewing seams: connect any pair of cloths with a seam (`addSeam`),
//     the manager runs the seam-relaxation pass before any other
//     constraint pass so the topology bond is the first to settle.
//
// Step pipeline per timestep (one full Marvelous Designer simulation
// tick):
//
//   1. For every cloth, run cloth2.solveCloth(state, dt, iterations)
//      — Verlet + PBD distance/bend (slice 765, unchanged).
//   2. For every cloth with selfCollisionEnabled: resolveSelfCollision
//      (cloth-internal particle pushes).
//   3. For every adjacent (layer_i, layer_{i+1}) pair: resolveCross-
//      ClothCollision (cross-layer particle pushes).
//   4. For the sewing state (one per stack): resolveSewing (zip every
//      seam pair tighter).
//   5. Each cloth: writeBackToGeometry (push positions onto the source
//      mesh's BufferGeometry so the viewport updates).
//
// Pure JS, builds on cloth2 + this slice's selfCollision + sewing.

import {
  buildClothFromGeometry, solveCloth, writeBackToGeometry,
} from '../cloth2/clothSolver.js';
import {
  buildSelfCollisionState, resolveSelfCollision, resolveCrossClothCollision,
} from './selfCollision.js';
import {
  buildSewingState, addSeam as _addSeam, removeSeam as _removeSeam,
  resolveSewing, seamGapReport,
} from './sewing.js';

/**
 * Build a multi-layer cloth stack.
 *
 * @param {Object} opts
 *   @param {Array<{mesh, layer?, clothOpts?, selfCollision?}>} opts.layers
 *     — one entry per cloth in the stack. `mesh` is a THREE.Mesh with a
 *     BufferGeometry; `layer` is the optional depth index (defaults to
 *     entry order); `clothOpts` is forwarded to buildClothFromGeometry;
 *     `selfCollision` is true/false (defaults to true).
 *   @param {Object} [opts.selfCollisionOpts] — common radius/stiffness
 *     for both self- and cross-layer collision passes.
 *   @param {Object} [opts.sewingOpts]        — common stiffness/restLength.
 *   @param {boolean} [opts.crossLayerCollision=true] — disable to drop
 *     cross-layer interaction entirely.
 *
 * @returns {Object|null} stack state, or null if any layer's cloth build
 *   failed (in which case the partial state is discarded).
 */
export function buildClothStack(opts) {
  const o = opts || {};
  if (!Array.isArray(o.layers) || o.layers.length === 0) return null;
  const scOpts = o.selfCollisionOpts || {};
  const sewOpts = o.sewingOpts || {};
  const cross = (o.crossLayerCollision === undefined) ? true : !!o.crossLayerCollision;

  const layers = [];
  for (let i = 0; i < o.layers.length; i++) {
    const entry = o.layers[i];
    if (!entry || !entry.mesh || !entry.mesh.geometry) return null;
    const cloth = buildClothFromGeometry(entry.mesh.geometry, entry.clothOpts || {});
    if (!cloth) return null;
    const layer = Number.isFinite(+entry.layer) ? +entry.layer : i;
    const selfColl = entry.selfCollision === undefined ? true : !!entry.selfCollision;
    const sc = buildSelfCollisionState(scOpts);
    layers.push({
      id: entry.mesh.uuid,
      mesh: entry.mesh,
      cloth,
      layer,
      selfCollisionEnabled: selfColl,
      sc,
    });
  }

  // Sort layers by depth — index 0 is the deepest (skin), N-1 outermost.
  layers.sort((a, b) => a.layer - b.layer);

  // Build cross-layer collision states (shared params, distinct grids).
  const crossStates = [];
  for (let i = 0; i + 1 < layers.length; i++) {
    crossStates.push(buildSelfCollisionState(scOpts));
  }

  return {
    layers,
    crossStates,
    crossLayerCollision: cross,
    sew: buildSewingState(sewOpts),
    // Used by sewing to look up cloths by id.
    _byId: new Map(layers.map((l) => [l.id, l.cloth])),
    elapsed: 0,
  };
}

/**
 * Step every cloth in the stack by `dt`, then run self-collision,
 * cross-layer collision, and sewing relaxation.
 *
 * @param {Object} stack
 * @param {number} [dt=1/60]
 * @param {number} [iterations=6]
 * @returns {Object} { ok, perLayerResidual:[], crossContacts, selfContacts,
 *                     seamPairsResolved }
 */
export function stepClothStack(stack, dt, iterations) {
  if (!stack) return { ok: false };
  const stepDt = Number.isFinite(+dt) ? +dt : (1 / 60);
  const iters = Math.max(1, Math.floor(iterations) || 6);
  const perLayer = [];
  // 1) Verlet + PBD distance/bend per cloth
  for (let i = 0; i < stack.layers.length; i++) {
    const l = stack.layers[i];
    const r = solveCloth(l.cloth, stepDt, iters);
    perLayer.push({ id: l.id, energyResidual: r.energyResidual });
  }
  // 2) Self-collision per cloth (if enabled)
  let selfContacts = 0;
  for (let i = 0; i < stack.layers.length; i++) {
    const l = stack.layers[i];
    if (!l.selfCollisionEnabled) continue;
    const r = resolveSelfCollision(l.cloth, l.sc);
    if (r && r.ok) selfContacts += r.contacts;
  }
  // 3) Cross-layer collision (adjacent layers)
  let crossContacts = 0;
  if (stack.crossLayerCollision) {
    for (let i = 0; i + 1 < stack.layers.length; i++) {
      const a = stack.layers[i].cloth;
      const b = stack.layers[i + 1].cloth;
      const r = resolveCrossClothCollision(a, b, stack.crossStates[i]);
      if (r && r.ok) crossContacts += r.contacts;
    }
  }
  // 4) Sewing relaxation — run multiple sub-iterations so the seam zips
  // fully even when the underlying cloth's PBD pass spreads the
  // correction over several steps.
  let seamPairsResolved = 0;
  const sewIters = Math.min(iters, 6);
  for (let it = 0; it < sewIters; it++) {
    const r = resolveSewing(stack.sew, stack._byId);
    if (r && r.ok) seamPairsResolved = r.pairsResolved;
  }
  // 5) Write each cloth back to its source geometry
  for (let i = 0; i < stack.layers.length; i++) {
    const l = stack.layers[i];
    writeBackToGeometry(l.cloth, l.mesh.geometry);
  }
  stack.elapsed += stepDt;
  return {
    ok: true,
    perLayerResidual: perLayer,
    crossContacts,
    selfContacts,
    seamPairsResolved,
  };
}

/**
 * Add a seam between two cloths in the stack.
 *
 * @param {Object} stack
 * @param {Array} loopA — [{ clothIdx | clothId, vertIdx }] OR a flat
 *   array of vertex indices when `idA` is supplied separately. Both
 *   shapes are accepted.
 * @param {Array} loopB — same shape as loopA
 * @param {Object} [opts] — { stiffness, restLength }
 * @returns {Object} { ok, seamIdx, pairCount, error? }
 */
export function addStackSeam(stack, loopA, loopB, opts) {
  if (!stack) return { ok: false, error: 'no-stack' };

  // Normalize loop format. Accepts either:
  //   ['ClothA', [v0, v1, ...]] OR
  //   { clothId, vertIdxs: [v0, v1, ...] } OR
  //   [{ clothId, vertIdx }, ...]
  function _decodeLoop(loop) {
    if (!loop) return null;
    if (Array.isArray(loop) && loop.length === 2
        && typeof loop[0] === 'string' && Array.isArray(loop[1])) {
      return { id: loop[0], verts: loop[1].map((v) => +v) };
    }
    if (typeof loop === 'object' && !Array.isArray(loop)
        && loop.clothId && Array.isArray(loop.vertIdxs)) {
      return { id: loop.clothId, verts: loop.vertIdxs.map((v) => +v) };
    }
    if (Array.isArray(loop) && loop.length > 0 && typeof loop[0] === 'object'
        && (loop[0].clothId !== undefined || loop[0].id !== undefined)) {
      // [{ clothId, vertIdx }, ...] — assert all share the same cloth id.
      const id = loop[0].clothId || loop[0].id;
      const verts = [];
      for (let i = 0; i < loop.length; i++) {
        const c = loop[i].clothId || loop[i].id;
        if (c !== id) return null;  // seam can't cross >2 cloths in one call
        verts.push(+loop[i].vertIdx);
      }
      return { id, verts };
    }
    return null;
  }

  const a = _decodeLoop(loopA);
  const b = _decodeLoop(loopB);
  if (!a || !b) return { ok: false, error: 'bad-loop-shape' };
  // Validate cloth ids are in the stack.
  if (!stack._byId.has(a.id)) return { ok: false, error: 'unknown-cloth-A' };
  if (!stack._byId.has(b.id)) return { ok: false, error: 'unknown-cloth-B' };
  return _addSeam(stack.sew, a.id, a.verts, b.id, b.verts, opts || {});
}

/**
 * Remove a seam by index. Returns { ok }.
 */
export function removeStackSeam(stack, seamIdx) {
  if (!stack) return { ok: false };
  return _removeSeam(stack.sew, seamIdx);
}

/**
 * Set the `selfCollisionEnabled` flag on every layer in the stack.
 */
export function setStackSelfCollision(stack, enable) {
  if (!stack) return { ok: false };
  const e = !!enable;
  for (let i = 0; i < stack.layers.length; i++) {
    stack.layers[i].selfCollisionEnabled = e;
  }
  return { ok: true, layerCount: stack.layers.length, enabled: e };
}

/**
 * Diagnostic report on the stack's current state.
 */
export function reportStack(stack) {
  if (!stack) return { ok: false };
  return {
    ok: true,
    layerCount: stack.layers.length,
    seamCount: stack.sew.seams.length,
    seamPairs: stack.sew.seams.reduce((n, s) => n + s.pairs.length, 0),
    crossLayerCollision: stack.crossLayerCollision,
    elapsed: stack.elapsed,
    layers: stack.layers.map((l) => ({
      id: l.id,
      layer: l.layer,
      vertCount: l.cloth.vertCount,
      constraintCount: l.cloth.constraints.length,
      pinnedCount: l.cloth.pinned.length,
      selfCollisionEnabled: l.selfCollisionEnabled,
    })),
    seamGaps: seamGapReport(stack.sew, stack._byId),
  };
}

export const __internal = { _addSeam, _removeSeam };
