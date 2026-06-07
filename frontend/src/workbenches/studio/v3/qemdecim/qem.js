// ArchDisc Studio V3 — Garland-Heckbert quadric error metric (QEM) mesh
// decimation (slice 786).
//
// Implements the classic "Surface Simplification Using Quadric Error
// Metrics" pipeline (Garland & Heckbert, SIGGRAPH 1997 — the algorithm
// every production decimator since then descends from: Blender's
// `MOD_decimate.cc`, MeshLab's `tri::Clean::QuadricSimplification`,
// Maya's `polyReduce`, OpenMesh's `MOD_QuadricT`).
//
// Pipeline:
//   1. Per-vertex quadric Q_v = Σ K_p   (plane equation outer-products
//      for every face incident to v).  Plane is `ax+by+cz+d=0` with
//      `(a,b,c)` the unit normal; K_p = pp^T where p = (a,b,c,d).
//   2. For every UNIQUE edge (u,v), error = v^T Q v at the OPTIMAL
//      contraction position v* — solved from the linear system formed by
//      the top-3 rows of Q_u + Q_v (with the bottom row replaced by
//      [0 0 0 1] so v.w is fixed at 1).  Singular fall-back: midpoint of
//      u and v (also evaluated at Q_u + Q_v).
//   3. Insert edges into a min-priority queue keyed on the cost.
//   4. Pop the cheapest edge, collapse it: pick a survivor + a doomed
//      vertex, move the survivor to v*, sum quadrics (Q_s += Q_d), drop
//      the doomed vert, rewrite every face referencing the doomed to
//      reference the survivor instead.
//   5. Invalidate every edge that referenced the doomed; recompute costs
//      for every edge incident to the survivor; re-insert into the
//      queue with a fresh "version" so stale entries are skipped on pop.
//   6. Stop when the target triangle count is reached.
//
// Pure JS. No dependencies. Operates on flat typed-array geometry:
//   verts: Float32Array of length 3·N     (xyz triplets)
//   tris:  Uint32Array  of length 3·T     (triangle vertex indices)
// Returns a new (verts, tris) pair plus a `removedFraction` + `error`
// metric (the sum of v^T Q v over every collapse — the total quadric
// error introduced by the simplification).

// ─── Plane / Quadric math ───────────────────────────────────────────────

// Plane equation (a,b,c,d) for a triangle (p0,p1,p2). Normal is the
// CROSS of the two edges, normalised. d = -(n·p0).
//
// Returns null for a degenerate triangle (zero-area), which the caller
// must skip — degenerate planes carry no quadric information and would
// otherwise contaminate Q.
function _trianglePlane(verts, ia, ib, ic) {
  const ax = verts[ia*3],     ay = verts[ia*3 + 1], az = verts[ia*3 + 2];
  const bx = verts[ib*3],     by = verts[ib*3 + 1], bz = verts[ib*3 + 2];
  const cx = verts[ic*3],     cy = verts[ic*3 + 1], cz = verts[ic*3 + 2];
  const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
  const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
  const nx = e1y * e2z - e1z * e2y;
  const ny = e1z * e2x - e1x * e2z;
  const nz = e1x * e2y - e1y * e2x;
  const L = Math.hypot(nx, ny, nz);
  if (L < 1e-12) return null;
  const a = nx / L, b = ny / L, c = nz / L;
  const d = -(a * ax + b * ay + c * az);
  return [a, b, c, d];
}

// Outer product of a plane vector p = (a,b,c,d) with itself, returned as
// the 10 unique entries of the symmetric 4x4 quadric K_p:
//   [Q00 Q01 Q02 Q03 Q11 Q12 Q13 Q22 Q23 Q33]
function _planeQuadric(plane) {
  const a = plane[0], b = plane[1], c = plane[2], d = plane[3];
  return [
    a*a, a*b, a*c, a*d,
         b*b, b*c, b*d,
              c*c, c*d,
                   d*d,
  ];
}

function _addQuadric(dst, src) {
  for (let i = 0; i < 10; i++) dst[i] += src[i];
}

function _newQuadric() {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}

// Evaluate v^T Q v at a 3D point (vx, vy, vz). Treats v as (vx,vy,vz,1).
// Expanded form of the symmetric 4x4 quadratic with w=1:
//   Q00 vx² + 2 Q01 vx vy + 2 Q02 vx vz + 2 Q03 vx
//         + Q11 vy² + 2 Q12 vy vz + 2 Q13 vy
//                   + Q22 vz²     + 2 Q23 vz
//                                + Q33
export function evalQuadric(Q, vx, vy, vz) {
  return (
    Q[0]*vx*vx + 2*Q[1]*vx*vy + 2*Q[2]*vx*vz + 2*Q[3]*vx
              +  Q[4]*vy*vy + 2*Q[5]*vy*vz + 2*Q[6]*vy
                            +  Q[7]*vz*vz + 2*Q[8]*vz
                                          +  Q[9]
  );
}

// Solve for the optimal contraction position by inverting the upper-left
// 3x3 of Q with right-hand side -(Q03, Q13, Q23). The original Garland-
// Heckbert paper sets the bottom row of the 4x4 to [0 0 0 1] and
// inverts; in expanded form that comes out to:
//   | Q00 Q01 Q02 | | x |     | -Q03 |
//   | Q01 Q11 Q12 | | y |  =  | -Q13 |
//   | Q02 Q12 Q22 | | z |     | -Q23 |
//
// Returns [x,y,z] on success, null if the matrix is too close to
// singular for stable inversion (caller falls back to midpoint).
function _solveOptimalPosition(Q) {
  const m00 = Q[0], m01 = Q[1], m02 = Q[2];
  const m11 = Q[4], m12 = Q[5];
  const m22 = Q[7];
  // 3x3 determinant via cofactor expansion along row 0.
  const c00 =  m11*m22 - m12*m12;
  const c01 = -(m01*m22 - m12*m02);
  const c02 =  m01*m12 - m11*m02;
  const det = m00*c00 + m01*c01 + m02*c02;
  if (Math.abs(det) < 1e-10) return null;
  const invDet = 1 / det;
  // Adjugate (full symmetric 3x3 inverse via cofactors).
  const c11 =  m00*m22 - m02*m02;
  const c12 = -(m00*m12 - m02*m01);
  const c22 =  m00*m11 - m01*m01;
  // b = (-Q03, -Q13, -Q23)
  const bx = -Q[3], by = -Q[6], bz = -Q[8];
  // x = adj·b / det   (note: adj is symmetric since Q is symmetric)
  const x = (c00*bx + c01*by + c02*bz) * invDet;
  const y = (c01*bx + c11*by + c12*bz) * invDet;
  const z = (c02*bx + c12*by + c22*bz) * invDet;
  return [x, y, z];
}

// Sum two quadrics into a fresh array (does not mutate either input).
function _sumQuadric(Qa, Qb) {
  return [
    Qa[0]+Qb[0], Qa[1]+Qb[1], Qa[2]+Qb[2], Qa[3]+Qb[3],
                 Qa[4]+Qb[4], Qa[5]+Qb[5], Qa[6]+Qb[6],
                              Qa[7]+Qb[7], Qa[8]+Qb[8],
                                           Qa[9]+Qb[9],
  ];
}

// ─── Vertex quadrics ────────────────────────────────────────────────────

// Compute the per-vertex quadric Q_v = Σ K_p for every face incident
// to v. Pure function over (verts, tris).
export function computeVertexQuadrics(verts, tris) {
  const N = verts.length / 3 | 0;
  const Q = new Array(N);
  for (let v = 0; v < N; v++) Q[v] = _newQuadric();
  const T = tris.length / 3 | 0;
  for (let t = 0; t < T; t++) {
    const ia = tris[t*3]     | 0;
    const ib = tris[t*3 + 1] | 0;
    const ic = tris[t*3 + 2] | 0;
    const plane = _trianglePlane(verts, ia, ib, ic);
    if (!plane) continue;
    const K = _planeQuadric(plane);
    _addQuadric(Q[ia], K);
    _addQuadric(Q[ib], K);
    _addQuadric(Q[ic], K);
  }
  return Q;
}

// ─── Min-heap priority queue (binary heap, array-backed) ────────────────

// Each entry is { cost, u, v, version, optPos } where `version` lets us
// recognise + skip stale entries on pop (we never bother to remove from
// the middle of the heap — just bump the version on the live edge and
// drop anything popped with a mismatched version).
function _heapPush(heap, entry) {
  heap.push(entry);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p].cost <= heap[i].cost) break;
    const tmp = heap[p]; heap[p] = heap[i]; heap[i] = tmp;
    i = p;
  }
}

function _heapPop(heap) {
  const n = heap.length;
  if (n === 0) return null;
  const top = heap[0];
  if (n === 1) { heap.pop(); return top; }
  heap[0] = heap.pop();
  let i = 0;
  for (;;) {
    const l = i*2 + 1, r = i*2 + 2;
    let best = i;
    if (l < heap.length && heap[l].cost < heap[best].cost) best = l;
    if (r < heap.length && heap[r].cost < heap[best].cost) best = r;
    if (best === i) break;
    const tmp = heap[best]; heap[best] = heap[i]; heap[i] = tmp;
    i = best;
  }
  return top;
}

// ─── Edge cost ──────────────────────────────────────────────────────────

// Compute the contraction cost for edge (u, v) using their summed
// quadric. Returns { cost, position: [x,y,z] }.
//
// Tries the optimal-position solver first (Garland-Heckbert §4); falls
// back to evaluating the three candidate points {u, v, midpoint} and
// picking the cheapest when the solve is singular (a near-degenerate
// quadric — happens on flat planar regions).
function _edgeCost(Q, verts, u, v) {
  const Qsum = _sumQuadric(Q[u], Q[v]);
  const opt = _solveOptimalPosition(Qsum);
  if (opt) {
    const cost = evalQuadric(Qsum, opt[0], opt[1], opt[2]);
    if (Number.isFinite(cost) && cost >= 0) {
      return { cost, position: opt };
    }
  }
  // Fall back: cheapest of {u, v, midpoint}.
  const ux = verts[u*3], uy = verts[u*3 + 1], uz = verts[u*3 + 2];
  const vx = verts[v*3], vy = verts[v*3 + 1], vz = verts[v*3 + 2];
  const mx = (ux + vx) * 0.5, my = (uy + vy) * 0.5, mz = (uz + vz) * 0.5;
  const cu = evalQuadric(Qsum, ux, uy, uz);
  const cv = evalQuadric(Qsum, vx, vy, vz);
  const cm = evalQuadric(Qsum, mx, my, mz);
  let cost = cu, position = [ux, uy, uz];
  if (cv < cost) { cost = cv; position = [vx, vy, vz]; }
  if (cm < cost) { cost = cm; position = [mx, my, mz]; }
  if (!Number.isFinite(cost) || cost < 0) cost = 0;
  return { cost, position };
}

// ─── Edge collection ────────────────────────────────────────────────────

// Canonical edge key (a, b) with a < b.
function _edgeKey(a, b) {
  return a < b ? (a * 0x80000000 + b) : (b * 0x80000000 + a);
}

// Build the unique edge set + per-vertex incidence lists.
//
// Returns:
//   edges     — Map<edgeKey, {u, v, version}>
//   vertEdges — Array<Set<edgeKey>>   per-vertex set of incident edges
//   vertTris  — Array<Set<triIndex>>  per-vertex set of incident tris
function _buildTopology(verts, tris) {
  const N = verts.length / 3 | 0;
  const edges = new Map();
  const vertEdges = new Array(N);
  const vertTris  = new Array(N);
  for (let v = 0; v < N; v++) {
    vertEdges[v] = new Set();
    vertTris[v]  = new Set();
  }
  const T = tris.length / 3 | 0;
  for (let t = 0; t < T; t++) {
    const ia = tris[t*3]     | 0;
    const ib = tris[t*3 + 1] | 0;
    const ic = tris[t*3 + 2] | 0;
    if (ia === ib || ib === ic || ic === ia) continue; // degenerate
    vertTris[ia].add(t);
    vertTris[ib].add(t);
    vertTris[ic].add(t);
    for (const [u, v] of [[ia, ib], [ib, ic], [ic, ia]]) {
      const k = _edgeKey(u, v);
      if (!edges.has(k)) {
        edges.set(k, { u: Math.min(u, v), v: Math.max(u, v), version: 0 });
      }
      vertEdges[u].add(k);
      vertEdges[v].add(k);
    }
  }
  return { edges, vertEdges, vertTris };
}

// ─── Edge collapse ──────────────────────────────────────────────────────

// Apply the collapse (u → v): vertex v becomes the survivor, moved to
// `optPos`; vertex u is dropped. Q[v] += Q[u]. Every triangle that
// referenced u now references v. Degenerate triangles (two of the three
// indices now equal) are dropped.
//
// Returns the number of triangles dropped by the collapse (always 1 or
// 2 for a manifold interior edge; 1 for a boundary edge).
function _applyCollapse(state, u, v, optPos) {
  const { verts, tris, Q, vertEdges, vertTris, alive } = state;
  // Move survivor v to opt position.
  verts[v*3]     = optPos[0];
  verts[v*3 + 1] = optPos[1];
  verts[v*3 + 2] = optPos[2];
  // Sum quadrics.
  Q[v] = _sumQuadric(Q[v], Q[u]);
  // Rewrite every triangle that referenced u.
  let killedTris = 0;
  const touchedTris = vertTris[u];
  for (const t of touchedTris) {
    if (state.triAlive[t] === 0) continue;
    let ia = tris[t*3], ib = tris[t*3 + 1], ic = tris[t*3 + 2];
    if (ia === u) ia = v;
    if (ib === u) ib = v;
    if (ic === u) ic = v;
    tris[t*3] = ia; tris[t*3 + 1] = ib; tris[t*3 + 2] = ic;
    // Degenerate? Drop it.
    if (ia === ib || ib === ic || ic === ia) {
      state.triAlive[t] = 0;
      killedTris++;
      // Detach from incident verts.
      vertTris[ia].delete(t);
      vertTris[ib].delete(t);
      vertTris[ic].delete(t);
    } else {
      vertTris[v].add(t);
    }
  }
  // u no longer owns any triangles.
  vertTris[u].clear();
  // Move every edge from u onto v (skip the (u,v) edge — it's being
  // collapsed). Edges to/from u become edges to/from v; if v already has
  // that neighbour, the duplicate is dropped.
  for (const k of vertEdges[u]) {
    const e = state.edges.get(k);
    if (!e) continue;
    if ((e.u === u && e.v === v) || (e.u === v && e.v === u)) {
      state.edges.delete(k);
      continue;
    }
    const other = e.u === u ? e.v : e.u;
    // Self-edge after collapse? (other === v) → drop.
    if (other === v) {
      state.edges.delete(k);
      continue;
    }
    state.edges.delete(k);
    const newKey = _edgeKey(v, other);
    if (state.edges.has(newKey)) {
      // Bump existing edge's version so any queued cost is invalidated.
      state.edges.get(newKey).version++;
    } else {
      state.edges.set(newKey, { u: Math.min(v, other), v: Math.max(v, other), version: 0 });
      vertEdges[other].add(newKey);
    }
    vertEdges[other].delete(k);
    vertEdges[v].add(newKey);
  }
  vertEdges[u].clear();
  // Mark u dead.
  alive[u] = 0;
  return killedTris;
}

// ─── Driver ─────────────────────────────────────────────────────────────

// Decimate `(verts, tris)` until the alive triangle count reaches
// `targetTris`. Returns the new (verts, tris) pair as compact typed
// arrays + accumulated quadric error.
//
// `targetTris` is clamped to [4, originalTris - 1].
export function decimateToTriCount(verts, tris, targetTris) {
  const inputVerts = verts.length / 3 | 0;
  const inputTris  = tris.length  / 3 | 0;
  // Defensive copies — we mutate.
  const V = new Float32Array(verts);
  const I = new Uint32Array(tris);
  const target = Math.max(4, Math.min(inputTris - 1, targetTris | 0));
  if (target >= inputTris) {
    return {
      verts: V,
      tris: I,
      error: 0,
      collapsed: 0,
      vertCount: inputVerts,
      triCount: inputTris,
    };
  }
  const Q = computeVertexQuadrics(V, I);
  const { edges, vertEdges, vertTris } = _buildTopology(V, I);
  const alive    = new Uint8Array(inputVerts).fill(1);
  const triAlive = new Uint8Array(inputTris).fill(1);
  const state = {
    verts: V, tris: I, Q, edges, vertEdges, vertTris,
    alive, triAlive,
  };
  // Seed the heap.
  const heap = [];
  for (const [k, e] of edges) {
    const { cost, position } = _edgeCost(Q, V, e.u, e.v);
    _heapPush(heap, {
      cost,
      key: k,
      version: e.version,
      position,
    });
  }
  let totalError = 0;
  let collapsed = 0;
  let aliveTris = inputTris;
  while (aliveTris > target && heap.length > 0) {
    const top = _heapPop(heap);
    if (!top) break;
    const e = edges.get(top.key);
    if (!e) continue;                      // edge dissolved
    if (e.version !== top.version) continue; // stale
    const u = e.u, v = e.v;
    if (!alive[u] || !alive[v]) continue;
    // Apply collapse. Survivor is the lower-index vertex by convention;
    // doomed is the higher (cheap, deterministic).
    const killed = _applyCollapse(state, u, v, top.position);
    aliveTris -= killed;
    totalError += top.cost;
    collapsed++;
    // Recompute costs for every edge incident to the survivor v.
    for (const k of vertEdges[v]) {
      const ee = edges.get(k);
      if (!ee) continue;
      const { cost: nc, position: np } = _edgeCost(Q, V, ee.u, ee.v);
      // Bump version so older queued entries for this key are dropped.
      ee.version++;
      _heapPush(heap, {
        cost: nc,
        key: k,
        version: ee.version,
        position: np,
      });
    }
    if (collapsed > inputTris * 4) break; // safety
  }
  // Compact output: drop dead verts/tris, remap indices.
  const newIndex = new Int32Array(inputVerts).fill(-1);
  let nextV = 0;
  for (let v = 0; v < inputVerts; v++) {
    if (alive[v]) newIndex[v] = nextV++;
  }
  const outVerts = new Float32Array(nextV * 3);
  for (let v = 0; v < inputVerts; v++) {
    const ni = newIndex[v];
    if (ni < 0) continue;
    outVerts[ni*3]     = V[v*3];
    outVerts[ni*3 + 1] = V[v*3 + 1];
    outVerts[ni*3 + 2] = V[v*3 + 2];
  }
  let nextT = 0;
  for (let t = 0; t < inputTris; t++) if (triAlive[t]) nextT++;
  const outTris = new Uint32Array(nextT * 3);
  let oi = 0;
  for (let t = 0; t < inputTris; t++) {
    if (!triAlive[t]) continue;
    outTris[oi++] = newIndex[I[t*3]];
    outTris[oi++] = newIndex[I[t*3 + 1]];
    outTris[oi++] = newIndex[I[t*3 + 2]];
  }
  return {
    verts: outVerts,
    tris: outTris,
    error: totalError,
    collapsed,
    vertCount: nextV,
    triCount: nextT,
  };
}

// Decimate until a fraction of the original triangle count is reached.
// `ratio` ∈ (0, 1] is the fraction to KEEP — 0.5 keeps half.
export function decimateByRatio(verts, tris, ratio) {
  const inputTris = tris.length / 3 | 0;
  const r = Math.max(0.01, Math.min(1.0, +ratio || 0.5));
  const target = Math.max(4, Math.floor(inputTris * r));
  return decimateToTriCount(verts, tris, target);
}
