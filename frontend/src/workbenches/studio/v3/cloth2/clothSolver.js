// ArchDisc Studio V3 — Marvelous Designer / Chaos Cloth real cloth
// simulation (slice 765).
//
// Pure-JS Verlet + PBD (position-based dynamics, Müller et al. 2007)
// cloth solver. Builds a constraint network directly from a THREE
// BufferGeometry's edge + face topology:
//
//   • DISTANCE constraints — one per unique triangle edge. The rest
//     length is the edge's initial length; the stiffness defaults to
//     1.0 (a hard constraint, fully relaxed every PBD pass).
//
//   • BEND constraints — one per pair of triangles sharing an edge.
//     The constraint records the distance between the two NON-shared
//     vertices (the "diagonal" across the hinge) and tries to preserve
//     it. This is the simplest valid bending term in PBD literature
//     (Müller 2007 §3.3, "Bending constraints") and avoids needing
//     dihedral-angle derivatives that the more sophisticated formula-
//     tions require.
//
//   • PIN vertices — verts whose mass = 0 are treated as fixed (their
//     positions are never moved by the integrator or by the constraint
//     projection). buildClothFromGeometry defaults to pinning the
//     "top row" — every vertex whose Y coordinate is within `topEps`
//     of the maximum Y in the mesh.
//
// Integration is plain Verlet (the original mass-springs scheme):
//
//   x_{n+1} = x_n + (x_n - x_{n-1}) * damping + a * dt^2
//
// followed by N (default 6) iterations of constraint projection. Each
// iteration walks every constraint and moves both endpoints along the
// constraint line such that ||p_a - p_b|| → restLength. Mass-weighted
// distribution so a pinned vertex (w=0) stays put and a free vertex
// (w=1) absorbs the full correction.
//
// "energyResidual" returned from solveCloth is the sum of squared
// constraint errors after the final pass — a useful liveness signal
// (drops to zero when the cloth is fully relaxed against gravity, e.g.
// hanging on its pins).

// ─── Build ──────────────────────────────────────────────────────────

/**
 * Build a cloth state from a THREE BufferGeometry.
 *
 * @param {THREE.BufferGeometry} geometry  — must have a position
 *   attribute; ideally indexed (every workbench-spawned plane is).
 *   Non-indexed geometries are accepted but every triangle's vertices
 *   are treated as distinct, which won't behave like cloth — pre-weld
 *   first.
 * @param {Object} opts
 *   @param {number} [opts.pinTopY] — Y coordinate threshold; any vertex
 *     with y >= pinTopY is pinned (mass = 0). When undefined, the
 *     top row is auto-detected: pinTopY = maxY - topEps.
 *   @param {number} [opts.topEps=1e-4] — auto-pin tolerance.
 *   @param {boolean} [opts.includeBend=true] — wire bend constraints.
 *   @param {number} [opts.distStiffness=1] — distance stiffness ∈ [0,1].
 *   @param {number} [opts.bendStiffness=0.3] — bend stiffness ∈ [0,1].
 *   @param {number} [opts.defaultMass=1] — mass for non-pinned verts.
 *
 * @returns {Object} clothState — opaque to callers; pass to solveCloth.
 */
export function buildClothFromGeometry(geometry, opts) {
  const o = opts || {};
  if (!geometry || !geometry.attributes || !geometry.attributes.position) {
    return null;
  }
  const posAttr = geometry.attributes.position;
  const vertCount = posAttr.count;
  if (vertCount < 3) return null;

  // ── Positions / prev / mass ─────────────────────────────────────
  const positions = new Float32Array(vertCount * 3);
  const prevPositions = new Float32Array(vertCount * 3);
  const masses = new Float32Array(vertCount);
  const defaultMass = Number.isFinite(+o.defaultMass) ? +o.defaultMass : 1;
  let maxY = -Infinity;
  for (let i = 0; i < vertCount; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    prevPositions[i * 3] = x;
    prevPositions[i * 3 + 1] = y;
    prevPositions[i * 3 + 2] = z;
    masses[i] = defaultMass;
    if (y > maxY) maxY = y;
  }
  const topEps = Number.isFinite(+o.topEps) ? +o.topEps : 1e-4;
  const pinTopY = Number.isFinite(+o.pinTopY) ? +o.pinTopY : (maxY - topEps);
  // ── Pin top row ─────────────────────────────────────────────────
  const pinned = [];
  for (let i = 0; i < vertCount; i++) {
    if (positions[i * 3 + 1] >= pinTopY) {
      masses[i] = 0;
      pinned.push(i);
    }
  }

  // ── Walk every triangle, collect edges + adjacency ──────────────
  const indices = geometry.index ? geometry.index.array : null;
  const triCount = indices
    ? Math.floor(indices.length / 3)
    : Math.floor(vertCount / 3);
  // edgeKey "a|b" → { a, b, restLength, faces: [triIdx, ...] }
  const edgeMap = new Map();
  function _edgeKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }
  function _dist(a, b) {
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  // tri verts: triVerts[t] = [v0, v1, v2]
  const triVerts = new Array(triCount);
  for (let t = 0; t < triCount; t++) {
    let a, b, c;
    if (indices) {
      a = indices[t * 3];
      b = indices[t * 3 + 1];
      c = indices[t * 3 + 2];
    } else {
      a = t * 3; b = t * 3 + 1; c = t * 3 + 2;
    }
    triVerts[t] = [a, b, c];
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const k = _edgeKey(u, v);
      const e = edgeMap.get(k);
      if (e) {
        e.faces.push(t);
      } else {
        edgeMap.set(k, { a: u < v ? u : v, b: u < v ? v : u, restLength: _dist(u, v), faces: [t] });
      }
    }
  }

  // ── Distance constraints ───────────────────────────────────────
  const distStiffness = Number.isFinite(+o.distStiffness) ? +o.distStiffness : 1;
  const constraints = [];
  for (const e of edgeMap.values()) {
    constraints.push({ kind: 'd', a: e.a, b: e.b, restLength: e.restLength, stiffness: distStiffness });
  }

  // ── Bend constraints — across each shared edge ────────────────
  const includeBend = (o.includeBend === undefined) ? true : !!o.includeBend;
  const bendStiffness = Number.isFinite(+o.bendStiffness) ? +o.bendStiffness : 0.3;
  let bendCount = 0;
  if (includeBend) {
    for (const e of edgeMap.values()) {
      if (e.faces.length !== 2) continue;
      const [t1, t2] = e.faces;
      // Find the non-shared vertex in each triangle.
      const tri1 = triVerts[t1];
      const tri2 = triVerts[t2];
      const shared = new Set([e.a, e.b]);
      const opp1 = tri1.find((v) => !shared.has(v));
      const opp2 = tri2.find((v) => !shared.has(v));
      if (opp1 === undefined || opp2 === undefined || opp1 === opp2) continue;
      const rest = _dist(opp1, opp2);
      if (rest > 0) {
        constraints.push({ kind: 'b', a: opp1, b: opp2, restLength: rest, stiffness: bendStiffness });
        bendCount++;
      }
    }
  }

  return {
    positions,
    prevPositions,
    masses,
    constraints,
    pinned,
    // Default external forces — caller can mutate via solver opts.
    gravity: [0, -9.81, 0],
    wind: [0, 0, 0],
    damping: 0.99,
    // Telemetry.
    distConstraintCount: edgeMap.size,
    bendConstraintCount: bendCount,
    vertCount,
  };
}

// ─── Solve ──────────────────────────────────────────────────────────

/**
 * Advance the cloth state by `dt` seconds, then project constraints
 * `iterations` times (PBD relaxation).
 *
 * @param {Object} clothState  — from buildClothFromGeometry.
 * @param {number} [dt=1/60]   — timestep in seconds.
 * @param {number} [iterations=6] — PBD relaxation passes.
 *
 * @returns {Object} { energyResidual } — sum of squared constraint
 *   errors after the final pass. The sign convention is that this is
 *   ALWAYS ≥ 0; a fully relaxed cloth (e.g. hanging at rest on its
 *   pins) tends towards 0.
 */
export function solveCloth(clothState, dt, iterations) {
  if (!clothState) return { ok: false, energyResidual: 0 };
  const stepDt = Number.isFinite(+dt) ? +dt : (1 / 60);
  const iters = Math.max(1, Math.floor(iterations) || 6);
  const { positions, prevPositions, masses, constraints } = clothState;
  const damping = Number.isFinite(+clothState.damping) ? +clothState.damping : 0.99;
  const gravity = clothState.gravity || [0, -9.81, 0];
  const wind = clothState.wind || [0, 0, 0];
  const ax = (gravity[0] || 0) + (wind[0] || 0);
  const ay = (gravity[1] || 0) + (wind[1] || 0);
  const az = (gravity[2] || 0) + (wind[2] || 0);
  const dt2 = stepDt * stepDt;
  const vertCount = masses.length;

  // ── Verlet integration ────────────────────────────────────────
  for (let i = 0; i < vertCount; i++) {
    if (masses[i] === 0) continue;
    const ix = i * 3, iy = i * 3 + 1, iz = i * 3 + 2;
    const px = positions[ix], py = positions[iy], pz = positions[iz];
    const vx = (px - prevPositions[ix]) * damping;
    const vy = (py - prevPositions[iy]) * damping;
    const vz = (pz - prevPositions[iz]) * damping;
    prevPositions[ix] = px;
    prevPositions[iy] = py;
    prevPositions[iz] = pz;
    positions[ix] = px + vx + ax * dt2;
    positions[iy] = py + vy + ay * dt2;
    positions[iz] = pz + vz + az * dt2;
  }

  // ── PBD constraint projection ─────────────────────────────────
  let residual = 0;
  for (let it = 0; it < iters; it++) {
    residual = 0;
    for (let c = 0; c < constraints.length; c++) {
      const con = constraints[c];
      const a = con.a, b = con.b;
      const wA = masses[a] === 0 ? 0 : 1 / masses[a];
      const wB = masses[b] === 0 ? 0 : 1 / masses[b];
      const wSum = wA + wB;
      if (wSum <= 0) continue;
      const ax2 = positions[a * 3], ay2 = positions[a * 3 + 1], az2 = positions[a * 3 + 2];
      const bx2 = positions[b * 3], by2 = positions[b * 3 + 1], bz2 = positions[b * 3 + 2];
      const dx = bx2 - ax2, dy = by2 - ay2, dz = bz2 - az2;
      const lenSq = dx * dx + dy * dy + dz * dz;
      if (lenSq <= 1e-20) continue;
      const len = Math.sqrt(lenSq);
      const diff = len - con.restLength;
      // Stiffness mapped to PBD per-iteration factor — k_eff = 1 -
      // (1 - k)^(1/iters) is the canonical attenuation that makes
      // total stiffness independent of `iters`, but for typical
      // k≈0.3..1 the linear factor is close enough and faster.
      const k = con.stiffness;
      const factor = (diff / len) * k;
      const corrAX = factor * (wA / wSum) * dx;
      const corrAY = factor * (wA / wSum) * dy;
      const corrAZ = factor * (wA / wSum) * dz;
      const corrBX = factor * (wB / wSum) * dx;
      const corrBY = factor * (wB / wSum) * dy;
      const corrBZ = factor * (wB / wSum) * dz;
      if (wA > 0) {
        positions[a * 3]     += corrAX;
        positions[a * 3 + 1] += corrAY;
        positions[a * 3 + 2] += corrAZ;
      }
      if (wB > 0) {
        positions[b * 3]     -= corrBX;
        positions[b * 3 + 1] -= corrBY;
        positions[b * 3 + 2] -= corrBZ;
      }
      residual += diff * diff;
    }
  }
  return { ok: true, energyResidual: residual };
}

// ─── Mutators (for ops) ─────────────────────────────────────────────

/** Pin a single vertex (mass → 0). */
export function pinVertex(clothState, vertIdx) {
  if (!clothState) return { ok: false };
  if (vertIdx < 0 || vertIdx >= clothState.masses.length) return { ok: false };
  clothState.masses[vertIdx] = 0;
  // Snap prevPositions to current so the pinned vertex doesn't carry
  // its old velocity forward into a constraint pass.
  const i = vertIdx;
  clothState.prevPositions[i * 3]     = clothState.positions[i * 3];
  clothState.prevPositions[i * 3 + 1] = clothState.positions[i * 3 + 1];
  clothState.prevPositions[i * 3 + 2] = clothState.positions[i * 3 + 2];
  if (!clothState.pinned.includes(vertIdx)) clothState.pinned.push(vertIdx);
  return { ok: true };
}

/** Replace the wind vector. */
export function setWind(clothState, dir, strength) {
  if (!clothState) return { ok: false };
  const s = Number.isFinite(+strength) ? +strength : 1;
  const d = dir || [0, 0, 0];
  const dx = Array.isArray(d) ? +d[0] || 0 : +d.x || 0;
  const dy = Array.isArray(d) ? +d[1] || 0 : +d.y || 0;
  const dz = Array.isArray(d) ? +d[2] || 0 : +d.z || 0;
  // Normalise dir then scale by strength so the wind force magnitude is
  // exactly `strength` regardless of the input dir's magnitude.
  const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dl <= 1e-12) {
    clothState.wind = [0, 0, 0];
  } else {
    clothState.wind = [dx / dl * s, dy / dl * s, dz / dl * s];
  }
  return { ok: true };
}

/** Snapshot positions back into a target BufferGeometry's position
 * attribute. */
export function writeBackToGeometry(clothState, geometry) {
  if (!clothState || !geometry || !geometry.attributes || !geometry.attributes.position) return false;
  const pos = geometry.attributes.position;
  const src = clothState.positions;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i, src[i * 3], src[i * 3 + 1], src[i * 3 + 2]);
  }
  pos.needsUpdate = true;
  if (typeof geometry.computeVertexNormals === 'function') {
    geometry.computeVertexNormals();
  }
  return true;
}
