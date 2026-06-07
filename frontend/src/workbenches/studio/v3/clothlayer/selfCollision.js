// ArchDisc Studio V3 — Marvelous Designer multi-layer garment stack
// (slice 780). Self-collision module.
//
// Implements particle-vs-particle collision detection for cloth meshes
// using a uniform spatial hash. The cloth solver in slice 765 only
// resolves DISTANCE + BEND constraints — there's nothing stopping the
// cloth surface from passing through itself when it folds. Marvelous
// Designer's signature behavior (folded shirt collars, accordion-pleat
// skirts, jacket lapels resting on the chest) is exactly this self-
// collision response.
//
// Algorithm:
//
//   1. Bucket every particle into a 3-D grid with cell size = particle
//      radius * 2. Cell key = "ix|iy|iz" with floor(p / cellSize).
//
//   2. For every particle, walk the 27-cell neighbourhood (-1..+1 on each
//      axis) and check pair-wise distance against every other particle
//      that landed in those buckets. The 27-cell sweep guarantees we
//      find every pair within cellSize of one another regardless of
//      which cell each ended up in.
//
//   3. On penetration (||p_a - p_b|| < 2r): push the two particles apart
//      along the contact normal by exactly the overlap amount. Mass-
//      weighted distribution so a pinned particle (w = 0) stays put.
//
// Pure JS, no new deps. The state object lives alongside the cloth state
// from slice 765 — the cloth solver itself stays untouched.
//
// Exported entry points:
//   buildSelfCollisionState(opts)        → state
//   resolveSelfCollision(clothState, scState) → { ok, contacts }
//
// `clothState` is whatever buildClothFromGeometry returned in cloth2:
//   it must have { positions: Float32Array(3N), masses: Float32Array(N) }.

const DEFAULT_RADIUS = 0.02;
const DEFAULT_FRICTION = 0.0;
const NEIGHBOUR_OFFSETS = (() => {
  const a = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dz = -1; dz <= 1; dz++)
        a.push([dx, dy, dz]);
  return a;
})();

/**
 * Build a self-collision state.
 * @param {Object} opts
 *   @param {number} [opts.radius=0.02]  — particle radius (metres).
 *   @param {number} [opts.cellSize]     — spatial-hash cell size; defaults
 *     to 2*radius so the 27-neighbour sweep covers a 2r radius search.
 *   @param {number} [opts.stiffness=1]  — contact-correction stiffness ∈
 *     [0,1]; 1 = full overlap removal per pass.
 *   @param {number} [opts.friction=0]   — tangential damping on contact
 *     (currently unused — reserved for slice 781).
 * @returns {Object} self-collision state.
 */
export function buildSelfCollisionState(opts) {
  const o = opts || {};
  const radius = Number.isFinite(+o.radius) ? +o.radius : DEFAULT_RADIUS;
  const cellSize = Number.isFinite(+o.cellSize)
    ? +o.cellSize
    : 2 * radius;
  const stiffness = Number.isFinite(+o.stiffness) ? +o.stiffness : 1;
  const friction = Number.isFinite(+o.friction) ? +o.friction : DEFAULT_FRICTION;
  return {
    radius,
    cellSize,
    stiffness,
    friction,
    // Reusable buckets — Map of "ix|iy|iz" → [particleIdx, ...]
    _grid: new Map(),
    // Last-pass diagnostic.
    lastContacts: 0,
  };
}

/**
 * Hash a world-space coordinate into a cell key.
 * @param {number} x
 * @param {number} y
 * @param {number} z
 * @param {number} cellSize
 * @returns {string}
 */
export function _cellKey(x, y, z, cellSize) {
  const ix = Math.floor(x / cellSize);
  const iy = Math.floor(y / cellSize);
  const iz = Math.floor(z / cellSize);
  return `${ix}|${iy}|${iz}`;
}

/**
 * Self-collision resolve pass.
 *
 * Walks every particle, buckets it, then for each particle checks every
 * other particle landing in the same or any of the 26 neighbouring
 * cells. On penetration the two particles are pushed apart along their
 * contact normal by the overlap, mass-weighted.
 *
 * Designed to be called every PBD relaxation iteration (or every other
 * iteration if perf is tight).
 *
 * @param {Object} clothState — { positions, masses, vertCount }
 * @param {Object} scState    — self-collision state from buildSelfCollisionState
 * @returns {Object} { ok, contacts }
 */
export function resolveSelfCollision(clothState, scState) {
  if (!clothState || !scState) return { ok: false, contacts: 0 };
  const { positions, masses } = clothState;
  if (!positions || !masses) return { ok: false, contacts: 0 };
  const N = masses.length;
  const r = scState.radius;
  const cellSize = scState.cellSize;
  const stiff = scState.stiffness;
  const grid = scState._grid;
  grid.clear();

  // ── Bucket every particle ─────────────────────────────────────────
  for (let i = 0; i < N; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const k = _cellKey(x, y, z, cellSize);
    let bin = grid.get(k);
    if (!bin) { bin = []; grid.set(k, bin); }
    bin.push(i);
  }

  // ── Pair-wise check inside the 27-cell neighbourhood ─────────────
  const minDist = 2 * r;
  const minDistSq = minDist * minDist;
  let contacts = 0;

  for (let i = 0; i < N; i++) {
    const ix = positions[i * 3];
    const iy = positions[i * 3 + 1];
    const iz = positions[i * 3 + 2];
    const cIX = Math.floor(ix / cellSize);
    const cIY = Math.floor(iy / cellSize);
    const cIZ = Math.floor(iz / cellSize);
    for (let n = 0; n < NEIGHBOUR_OFFSETS.length; n++) {
      const off = NEIGHBOUR_OFFSETS[n];
      const key = `${cIX + off[0]}|${cIY + off[1]}|${cIZ + off[2]}`;
      const bin = grid.get(key);
      if (!bin) continue;
      for (let bIdx = 0; bIdx < bin.length; bIdx++) {
        const j = bin[bIdx];
        // Avoid double-resolving the same pair (i, j) and (j, i): only
        // resolve when j > i. This is correct because both i and j will
        // land in each other's 27-cell neighbourhoods.
        if (j <= i) continue;
        const jx = positions[j * 3];
        const jy = positions[j * 3 + 1];
        const jz = positions[j * 3 + 2];
        const dx = jx - ix;
        const dy = jy - iy;
        const dz = jz - iz;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq >= minDistSq) continue;
        if (distSq < 1e-20) continue;  // coincident — skip rather than NaN
        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        // Mass-weighted push: w_i = 1 / m_i (0 if pinned).
        const wA = masses[i] === 0 ? 0 : 1 / masses[i];
        const wB = masses[j] === 0 ? 0 : 1 / masses[j];
        const wSum = wA + wB;
        if (wSum <= 0) continue;
        const inv = 1 / dist;
        const nxh = dx * inv;
        const nyh = dy * inv;
        const nzh = dz * inv;
        const corr = overlap * stiff;
        const corrA = corr * (wA / wSum);
        const corrB = corr * (wB / wSum);
        if (wA > 0) {
          positions[i * 3]     -= nxh * corrA;
          positions[i * 3 + 1] -= nyh * corrA;
          positions[i * 3 + 2] -= nzh * corrA;
        }
        if (wB > 0) {
          positions[j * 3]     += nxh * corrB;
          positions[j * 3 + 1] += nyh * corrB;
          positions[j * 3 + 2] += nzh * corrB;
        }
        contacts++;
      }
    }
  }

  scState.lastContacts = contacts;
  return { ok: true, contacts };
}

/**
 * Cross-cloth collision: same algorithm but between two distinct cloth
 * meshes (e.g. shirt vs body / shirt vs trousers). The combined particle
 * set is bucketed into one grid and pair-wise resolution is restricted
 * to particles from DIFFERENT meshes only (so each mesh handles its own
 * self-collision via `resolveSelfCollision`).
 *
 * @param {Object} clothA — { positions, masses }
 * @param {Object} clothB — { positions, masses }
 * @param {Object} scState — shared self-collision params
 * @returns {Object} { ok, contacts }
 */
export function resolveCrossClothCollision(clothA, clothB, scState) {
  if (!clothA || !clothB || !scState) return { ok: false, contacts: 0 };
  const posA = clothA.positions, masA = clothA.masses;
  const posB = clothB.positions, masB = clothB.masses;
  if (!posA || !posB) return { ok: false, contacts: 0 };
  const NA = masA.length, NB = masB.length;
  const r = scState.radius;
  const cellSize = scState.cellSize;
  const stiff = scState.stiffness;
  const grid = new Map();

  // Bucket cloth A
  for (let i = 0; i < NA; i++) {
    const x = posA[i * 3], y = posA[i * 3 + 1], z = posA[i * 3 + 2];
    const k = _cellKey(x, y, z, cellSize);
    let bin = grid.get(k);
    if (!bin) { bin = []; grid.set(k, bin); }
    bin.push(i);
  }

  const minDist = 2 * r;
  const minDistSq = minDist * minDist;
  let contacts = 0;

  // For every particle in B, look up the 27-cell neighbourhood in the A
  // grid and resolve.
  for (let j = 0; j < NB; j++) {
    const bx = posB[j * 3], by = posB[j * 3 + 1], bz = posB[j * 3 + 2];
    const cIX = Math.floor(bx / cellSize);
    const cIY = Math.floor(by / cellSize);
    const cIZ = Math.floor(bz / cellSize);
    for (let n = 0; n < NEIGHBOUR_OFFSETS.length; n++) {
      const off = NEIGHBOUR_OFFSETS[n];
      const key = `${cIX + off[0]}|${cIY + off[1]}|${cIZ + off[2]}`;
      const bin = grid.get(key);
      if (!bin) continue;
      for (let bIdx = 0; bIdx < bin.length; bIdx++) {
        const i = bin[bIdx];
        const ax = posA[i * 3], ay = posA[i * 3 + 1], az = posA[i * 3 + 2];
        const dx = bx - ax, dy = by - ay, dz = bz - az;
        const distSq = dx * dx + dy * dy + dz * dz;
        if (distSq >= minDistSq) continue;
        if (distSq < 1e-20) continue;
        const dist = Math.sqrt(distSq);
        const overlap = minDist - dist;
        const wA = masA[i] === 0 ? 0 : 1 / masA[i];
        const wB = masB[j] === 0 ? 0 : 1 / masB[j];
        const wSum = wA + wB;
        if (wSum <= 0) continue;
        const inv = 1 / dist;
        const nxh = dx * inv;
        const nyh = dy * inv;
        const nzh = dz * inv;
        const corr = overlap * stiff;
        const corrA = corr * (wA / wSum);
        const corrB = corr * (wB / wSum);
        if (wA > 0) {
          posA[i * 3]     -= nxh * corrA;
          posA[i * 3 + 1] -= nyh * corrA;
          posA[i * 3 + 2] -= nzh * corrA;
        }
        if (wB > 0) {
          posB[j * 3]     += nxh * corrB;
          posB[j * 3 + 1] += nyh * corrB;
          posB[j * 3 + 2] += nzh * corrB;
        }
        contacts++;
      }
    }
  }
  return { ok: true, contacts };
}

export const __internal = { NEIGHBOUR_OFFSETS, DEFAULT_RADIUS };
