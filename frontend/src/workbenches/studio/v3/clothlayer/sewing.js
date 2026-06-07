// ArchDisc Studio V3 — Marvelous Designer multi-layer garment stack
// (slice 780). Sewing module.
//
// Implements PBD position constraints that stitch one vertex loop on
// cloth A to a matching vertex loop on cloth B (a "seam"). This is the
// Marvelous Designer "sew the front-panel side seam to the back-panel
// side seam" gesture: the two cloth pieces start as separate planes and
// after a few PBD passes the seam pairs zip together exactly.
//
// A seam is just a set of (vertA, vertB) index pairs with rest distance
// zero. Each pair is treated as a hard PBD distance constraint:
//
//   p_a' = p_a + (wA/(wA+wB)) * (p_b - p_a)
//   p_b' = p_b - (wB/(wA+wB)) * (p_b - p_a)
//
// where w_x is 1/mass_x. A pinned vertex (mass = 0) absorbs no
// correction. After 6-8 PBD passes the two endpoints coincide.
//
// The seam constraints are STORED separately from the cloth solver's
// internal constraint list so they can:
//   • cross between cloth instances (cloth A and cloth B own different
//     position arrays)
//   • be added / removed at runtime by gestures (the Marvelous Designer
//     "sew" tool)
//   • optionally have a non-zero rest length (for trim or seam allowance)
//
// Pure JS, no new deps.

/**
 * Build an empty sewing state.
 * @param {Object} [opts]
 *   @param {number} [opts.stiffness=1]   — seam-pull stiffness per pass.
 *   @param {number} [opts.restLength=0]  — default rest length (zero =
 *     coincident; positive = a small gap, e.g. seam allowance).
 * @returns {Object} sewing state.
 */
export function buildSewingState(opts) {
  const o = opts || {};
  return {
    stiffness: Number.isFinite(+o.stiffness) ? +o.stiffness : 1,
    restLength: Number.isFinite(+o.restLength) ? +o.restLength : 0,
    // Each seam: { idA, idB, pairs: [{ ia, ib, restLength, stiffness }] }
    // where idA / idB are caller-supplied cloth identifiers (typically
    // mesh uuids) and `ia`, `ib` are vertex indices within those cloths.
    seams: [],
  };
}

/**
 * Add a seam between two cloth loops.
 *
 * @param {Object} sewState — from buildSewingState
 * @param {string} idA — cloth A identifier
 * @param {number[]} loopA — ordered vertex indices in cloth A
 * @param {string} idB — cloth B identifier
 * @param {number[]} loopB — ordered vertex indices in cloth B
 * @param {Object} [opts] — { stiffness, restLength } overrides
 * @returns {Object} { ok, seamIdx?, pairCount?, error? }
 *
 * Loops are zipped element-by-element. If the two loops have different
 * lengths the shorter one is resampled to match: every vertex in the
 * shorter loop is paired with `floor(j * (L_short - 1) / (L_long - 1))`
 * in the longer (nearest-neighbour resample so we don't need to
 * interpolate vertex indices).
 */
export function addSeam(sewState, idA, loopA, idB, loopB, opts) {
  if (!sewState) return { ok: false, error: 'no-sew-state' };
  if (!idA || !idB) return { ok: false, error: 'missing-cloth-id' };
  if (!Array.isArray(loopA) || !Array.isArray(loopB)) {
    return { ok: false, error: 'loops-must-be-arrays' };
  }
  if (loopA.length < 1 || loopB.length < 1) {
    return { ok: false, error: 'empty-loop' };
  }
  const o = opts || {};
  const stiffness = Number.isFinite(+o.stiffness) ? +o.stiffness : sewState.stiffness;
  const restLength = Number.isFinite(+o.restLength) ? +o.restLength : sewState.restLength;

  // Resample shorter loop to match longer.
  const LA = loopA.length, LB = loopB.length;
  const L = Math.max(LA, LB);
  const pairs = new Array(L);
  for (let k = 0; k < L; k++) {
    const ia = LA === L
      ? loopA[k]
      : loopA[Math.floor(k * (LA - 1) / Math.max(1, L - 1))];
    const ib = LB === L
      ? loopB[k]
      : loopB[Math.floor(k * (LB - 1) / Math.max(1, L - 1))];
    pairs[k] = { ia, ib, restLength, stiffness };
  }
  const seamIdx = sewState.seams.length;
  sewState.seams.push({ idA, idB, pairs });
  return { ok: true, seamIdx, pairCount: pairs.length };
}

/**
 * Remove a seam by index. Returns { ok }.
 */
export function removeSeam(sewState, seamIdx) {
  if (!sewState) return { ok: false };
  if (seamIdx < 0 || seamIdx >= sewState.seams.length) return { ok: false };
  sewState.seams.splice(seamIdx, 1);
  return { ok: true };
}

/**
 * One PBD relaxation pass over every seam.
 *
 * `clothsById` is a map from cloth id → cloth state ({positions, masses}).
 *
 * @param {Object} sewState
 * @param {Map<string, Object>|Object} clothsById
 * @returns {Object} { ok, pairsResolved }
 */
export function resolveSewing(sewState, clothsById) {
  if (!sewState) return { ok: false, pairsResolved: 0 };
  if (!clothsById) return { ok: false, pairsResolved: 0 };
  const lookup = clothsById instanceof Map
    ? (id) => clothsById.get(id)
    : (id) => clothsById[id];
  let pairsResolved = 0;
  for (let s = 0; s < sewState.seams.length; s++) {
    const seam = sewState.seams[s];
    const clothA = lookup(seam.idA);
    const clothB = lookup(seam.idB);
    if (!clothA || !clothB) continue;
    const posA = clothA.positions, masA = clothA.masses;
    const posB = clothB.positions, masB = clothB.masses;
    if (!posA || !posB) continue;
    for (let p = 0; p < seam.pairs.length; p++) {
      const pair = seam.pairs[p];
      const ia = pair.ia, ib = pair.ib;
      if (ia < 0 || ia >= masA.length) continue;
      if (ib < 0 || ib >= masB.length) continue;
      const wA = masA[ia] === 0 ? 0 : 1 / masA[ia];
      const wB = masB[ib] === 0 ? 0 : 1 / masB[ib];
      const wSum = wA + wB;
      if (wSum <= 0) continue;
      const ax = posA[ia * 3], ay = posA[ia * 3 + 1], az = posA[ia * 3 + 2];
      const bx = posB[ib * 3], by = posB[ib * 3 + 1], bz = posB[ib * 3 + 2];
      const dx = bx - ax, dy = by - ay, dz = bz - az;
      const lenSq = dx * dx + dy * dy + dz * dz;
      const rest = pair.restLength;
      if (lenSq <= 1e-20 && rest === 0) continue;  // already coincident
      const len = lenSq <= 1e-20 ? 0 : Math.sqrt(lenSq);
      const diff = len - rest;
      const k = pair.stiffness;
      // factor on (dx,dy,dz) — when len === 0 and rest !== 0 we can't
      // form a direction, push along Y as a fallback (only fires for
      // degenerate zero-overlap pairs with non-zero rest length).
      if (len === 0) {
        const corr = -rest * k * 0.5;
        if (wA > 0) posA[ia * 3 + 1] -= corr * (wA / wSum);
        if (wB > 0) posB[ib * 3 + 1] += corr * (wB / wSum);
        pairsResolved++;
        continue;
      }
      const factor = (diff / len) * k;
      const cA_x = factor * (wA / wSum) * dx;
      const cA_y = factor * (wA / wSum) * dy;
      const cA_z = factor * (wA / wSum) * dz;
      const cB_x = factor * (wB / wSum) * dx;
      const cB_y = factor * (wB / wSum) * dy;
      const cB_z = factor * (wB / wSum) * dz;
      if (wA > 0) {
        posA[ia * 3]     += cA_x;
        posA[ia * 3 + 1] += cA_y;
        posA[ia * 3 + 2] += cA_z;
      }
      if (wB > 0) {
        posB[ib * 3]     -= cB_x;
        posB[ib * 3 + 1] -= cB_y;
        posB[ib * 3 + 2] -= cB_z;
      }
      pairsResolved++;
    }
  }
  return { ok: true, pairsResolved };
}

/**
 * Diagnostic: report the L2 distance between every seam pair (so a test
 * can verify the seam zipped together after stepping).
 *
 * @returns {Array<{seamIdx, avgGap, maxGap, pairCount}>}
 */
export function seamGapReport(sewState, clothsById) {
  if (!sewState) return [];
  const lookup = clothsById instanceof Map
    ? (id) => clothsById.get(id)
    : (id) => clothsById[id];
  const out = [];
  for (let s = 0; s < sewState.seams.length; s++) {
    const seam = sewState.seams[s];
    const clothA = lookup(seam.idA);
    const clothB = lookup(seam.idB);
    if (!clothA || !clothB) { out.push({ seamIdx: s, avgGap: NaN, maxGap: NaN, pairCount: 0 }); continue; }
    const posA = clothA.positions, posB = clothB.positions;
    let sum = 0, maxG = 0;
    for (let p = 0; p < seam.pairs.length; p++) {
      const { ia, ib } = seam.pairs[p];
      const dx = posB[ib * 3]     - posA[ia * 3];
      const dy = posB[ib * 3 + 1] - posA[ia * 3 + 1];
      const dz = posB[ib * 3 + 2] - posA[ia * 3 + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      sum += d;
      if (d > maxG) maxG = d;
    }
    out.push({
      seamIdx: s,
      avgGap: sum / seam.pairs.length,
      maxGap: maxG,
      pairCount: seam.pairs.length,
    });
  }
  return out;
}
