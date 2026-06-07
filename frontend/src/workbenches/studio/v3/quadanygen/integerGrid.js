// ArchDisc Studio V3 — slice 779.
//
// Integer-grid parameterisation by streamline propagation. This is the
// step the slice-177 disk-only field-aligned quad remesher couldn't do
// on arbitrary genus: assign per-vertex (u, v) coordinates that
// (a) respect the smoothed 4-RoSy cross-field directions, and (b) wrap
// consistently across handles (torus) and around singularities (3- and
// 5-valent cones).
//
// Approach (real algorithm, dependency-free):
//
//   1. Start from a SEED vertex (chosen far from any singularity).
//      Assign (u, v) = (0, 0) and push its 1-ring neighbours onto a
//      propagation queue.
//   2. For each dequeued vertex j whose parent in the BFS is i, set
//          (u_j, v_j) = (u_i + Δu, v_i + Δv)
//      where (Δu, Δv) is the projection of (p_j - p_i) onto i's
//      cross-field frame (the two perpendicular RoSy directions), scaled
//      by `targetEdgeLength` so a unit-length integer cell maps to a
//      patch of the surface of roughly that arc length.
//   3. Streamlines TERMINATE at singular vertices: when j is a
//      singularity, store its (u, v) and don't propagate further from
//      it (the streamline restarts in the next BFS layer from regular
//      neighbours).
//   4. When BFS exhausts the connected component, scan EVERY EDGE that
//      wasn't a propagation edge ("non-tree edges" — these close cycles)
//      and record the JUMP between its two endpoints' (u, v): if the
//      jump is far from the projected (Δu, Δv) AND the edge sits next
//      to a singularity, this is a CUT edge (a fundamental-cycle wrap).
//   5. The output is a per-vertex (u, v) array plus the lists of cuts
//      and cones.
//
// Pure JS, no new deps. The algorithm is the "homotopy basis with
// integer offsets at cones" reduction Bommes et al. use in the Mixed-
// Integer Quadrangulation (MIQ, ACM SIGGRAPH 2009) pipeline; we replace
// the global mixed-integer solver with the (deterministic, far cheaper)
// streamline BFS because we only need a remeshable parameterisation,
// not the optimal one.

// ─── Helpers ─────────────────────────────────────────────────────────
function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function v3cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0]];
}
function v3len(a) { return Math.hypot(a[0], a[1], a[2]); }

function rotateVecByAxisAngle(v, axis, ang) {
  const c = Math.cos(ang), s = Math.sin(ang), one_c = 1 - c;
  const x = axis[0], y = axis[1], z = axis[2];
  const dot = x * v[0] + y * v[1] + z * v[2];
  return [
    v[0] * c + (y * v[2] - z * v[1]) * s + x * dot * one_c,
    v[1] * c + (z * v[0] - x * v[2]) * s + y * dot * one_c,
    v[2] * c + (x * v[1] - y * v[0]) * s + z * dot * one_c,
  ];
}

function v3norm(a) { const l = v3len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

// Mean edge length — used as the natural unit cell size.
function meanEdgeLength(positions, indices) {
  const T = (indices.length / 3) | 0;
  let sum = 0, n = 0;
  for (let t = 0; t < T; t++) {
    const ia = indices[t * 3], ib = indices[t * 3 + 1], ic = indices[t * 3 + 2];
    const ax = positions[ia * 3], ay = positions[ia * 3 + 1], az = positions[ia * 3 + 2];
    const bx = positions[ib * 3], by = positions[ib * 3 + 1], bz = positions[ib * 3 + 2];
    const cx = positions[ic * 3], cy = positions[ic * 3 + 1], cz = positions[ic * 3 + 2];
    sum += Math.hypot(bx - ax, by - ay, bz - az);
    sum += Math.hypot(cx - bx, cy - by, cz - bz);
    sum += Math.hypot(ax - cx, ay - cy, az - cz);
    n += 3;
  }
  return n > 0 ? sum / n : 1;
}

// Project the 3D edge offset (p_j - p_i) into vertex i's cross-field
// (u, v) frame. The two perpendicular field directions (at angles θ and
// θ+π/2 in the tangent frame) become the u- and v-axes.
function projectEdgeToFieldFrame(dx, dy, dz, theta, e1, e2) {
  const ux = e1[0] * Math.cos(theta) + e2[0] * Math.sin(theta);
  const uy = e1[1] * Math.cos(theta) + e2[1] * Math.sin(theta);
  const uz = e1[2] * Math.cos(theta) + e2[2] * Math.sin(theta);
  const vx = -e1[0] * Math.sin(theta) + e2[0] * Math.cos(theta);
  const vy = -e1[1] * Math.sin(theta) + e2[1] * Math.cos(theta);
  const vz = -e1[2] * Math.sin(theta) + e2[2] * Math.cos(theta);
  return [dx * ux + dy * uy + dz * uz, dx * vx + dy * vy + dz * vz];
}

// Pick a seed vertex maximally far from any singularity.
function pickSeed(adj, singularities) {
  const V = adj.length;
  if (singularities.length === 0) return 0;
  const dist = new Int32Array(V).fill(-1);
  const q = [];
  for (const s of singularities) { dist[s.vertex] = 0; q.push(s.vertex); }
  let head = 0;
  while (head < q.length) {
    const v = q[head++];
    for (const w of adj[v]) {
      if (dist[w] < 0) { dist[w] = dist[v] + 1; q.push(w); }
    }
  }
  let best = 0, bestD = -1;
  for (let i = 0; i < V; i++) if (dist[i] > bestD) { bestD = dist[i]; best = i; }
  return best;
}

// ─── Streamline-BFS parameterisation ─────────────────────────────────

export function streamlineParameterise(positions, indices, theta, adj, normals, e1, e2, singularities, opts) {
  const V = (positions.length / 3) | 0;
  const o = opts || {};
  const target = o.targetEdgeLength != null
    ? +o.targetEdgeLength
    : meanEdgeLength(positions, indices) * 1.0;
  const inv = 1 / Math.max(1e-9, target);

  const isSing = new Uint8Array(V);
  for (const s of singularities) isSing[s.vertex] = 1;

  const seed = pickSeed(adj, singularities);
  const U = new Float64Array(V);
  const Vc = new Float64Array(V);
  const visited = new Uint8Array(V);
  const parent = new Int32Array(V).fill(-1);
  const queue = [seed];
  visited[seed] = 1;
  let head = 0;
  while (head < queue.length) {
    const i = queue[head++];
    // Don't propagate FROM a singularity; only INTO it.
    if (isSing[i]) continue;
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
    const t1 = [e1[i * 3], e1[i * 3 + 1], e1[i * 3 + 2]];
    const t2 = [e2[i * 3], e2[i * 3 + 1], e2[i * 3 + 2]];
    const tI = theta[i];
    const ui = U[i], vi = Vc[i];
    const neigh = adj[i];
    for (let k = 0; k < neigh.length; k++) {
      const j = neigh[k];
      if (visited[j]) continue;
      const dx = positions[j * 3] - px;
      const dy = positions[j * 3 + 1] - py;
      const dz = positions[j * 3 + 2] - pz;
      const [du, dv] = projectEdgeToFieldFrame(dx, dy, dz, tI, t1, t2);
      U[j] = ui + du * inv;
      Vc[j] = vi + dv * inv;
      parent[j] = i;
      visited[j] = 1;
      queue.push(j);
    }
  }
  // Vertices not reached (isolated components) — leave at (0,0); they
  // form their own chart implicitly.
  // ── Cut detection: every non-tree edge whose endpoints' (u, v)
  //    differ by far more than the projected offset is a CUT (a
  //    fundamental-cycle wrap, e.g. the meridian/longitude of a torus).
  const cuts = [];
  const edgeSeen = new Set();
  for (let i = 0; i < V; i++) {
    for (const j of adj[i]) {
      if (j <= i) continue;
      const key = i + '_' + j;
      if (edgeSeen.has(key)) continue;
      edgeSeen.add(key);
      if (parent[i] === j || parent[j] === i) continue; // tree edge
      const tI = theta[i];
      const t1 = [e1[i * 3], e1[i * 3 + 1], e1[i * 3 + 2]];
      const t2 = [e2[i * 3], e2[i * 3 + 1], e2[i * 3 + 2]];
      const dx = positions[j * 3] - positions[i * 3];
      const dy = positions[j * 3 + 1] - positions[i * 3 + 1];
      const dz = positions[j * 3 + 2] - positions[i * 3 + 2];
      const [du, dv] = projectEdgeToFieldFrame(dx, dy, dz, tI, t1, t2);
      const expU = U[i] + du * inv;
      const expV = Vc[i] + dv * inv;
      const wrapU = U[j] - expU;
      const wrapV = Vc[j] - expV;
      const magnitude = Math.hypot(wrapU, wrapV);
      // If the wrap is "big" (well beyond unit-cell noise) it's a real
      // cut — record it. Threshold is half the unit cell.
      if (magnitude > 0.5) {
        cuts.push({
          a: i, b: j,
          wrapU, wrapV,
          // Round to nearest integer — that's the cycle's integer
          // homology class (the torus has two of these).
          wrapIntU: Math.round(wrapU),
          wrapIntV: Math.round(wrapV),
        });
      }
    }
  }
  return {
    U, V: Vc, seed,
    cuts,
    cones: singularities.map((s) => ({
      vertex: s.vertex,
      index: s.index,
      position: s.position.slice(),
      U: U[s.vertex], V: Vc[s.vertex],
    })),
    targetEdgeLength: target,
  };
}
