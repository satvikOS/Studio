// ArchDisc Studio V3 — slice 779.
//
// Principal-curvature cross-field on an arbitrary triangle mesh, RoSy-4
// (period-π/2) symmetric direction smoothing across 1-rings, and
// singularity detection.
//
// The slice-177 `remesh/fieldAlignedQuad.js` only handles parametric
// (disk-topology) surfaces because the field there is sampled in (u,v)
// parameter space. For ARBITRARY-GENUS triangle meshes (torus, two-hole
// sphere, anything with handles or holes), the field has to live ON the
// vertices, smoothed across the mesh graph, with singularities (vertices
// where the field's index ≠ 0) explicitly located. That is what this
// file does:
//
//   1. Per vertex, build a local tangent frame (e1, e2) orthogonal to
//      the area-weighted vertex normal.
//   2. Estimate the discrete shape operator S (2x2 matrix in that frame)
//      by least-squares fitting the second-fundamental-form coefficients
//      from the 1-ring neighbour offsets: for each 1-ring neighbour j,
//          h_j ≈ ½ [t_j]ᵀ S [t_j]
//      where t_j is the tangent-plane projection of (p_j - p_i) and
//      h_j is its normal-component. With ≥3 neighbours that's a closed
//      form 3×3 normal-equations solve for (S11, S22, S12).
//   3. The eigenvector of S for the larger-magnitude eigenvalue is the
//      maximum-principal-curvature direction in the tangent frame. Its
//      angle θ_i in that frame is the per-vertex cross-field angle —
//      taken modulo π/2 because a 4-RoSy field is invariant under
//      π/2 rotation.
//   4. RoSy-4 smoothing: average exp(i·4·θ) over each vertex's 1-ring,
//      transporting neighbour angles into the local frame via the
//      smallest-rotation-between-normals parallel transport, then take
//      arg(·) / 4. Iterate.
//   5. Singularities: walk each vertex's 1-ring counter-clockwise around
//      the vertex normal and sum the signed angle differences between
//      consecutive (parallel-transported) neighbour field directions,
//      each wrapped into (-π/4, π/4]. The total mod π/2 gives the
//      vertex's PERIOD JUMP — ±π/2 means a 3- or 5-valent singularity,
//      i.e. an integer-grid CONE that the streamline parameterisation
//      has to handle explicitly.
//
// Pure JS, no new deps. All math is closed-form per vertex; cost is
// O(V · valence) per smoothing iteration.

// ─── Small 3-vector helpers ──────────────────────────────────────────
function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function v3cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0]];
}
function v3len(a) { return Math.hypot(a[0], a[1], a[2]); }
function v3norm(a) { const l = v3len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
function v3scale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
function v3add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

// ─── Mesh accessors ──────────────────────────────────────────────────
// `positions` is Float32Array length 3·V (flat xyz).
// `indices` is Uint32Array / Uint16Array / plain array length 3·T.
// Returns parallel arrays we use everywhere downstream.

export function buildAdjacency(positions, indices) {
  const V = (positions.length / 3) | 0;
  const T = (indices.length / 3) | 0;
  // adj[i] = unique sorted list of 1-ring neighbour indices
  const adjSet = Array.from({ length: V }, () => new Set());
  for (let t = 0; t < T; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    adjSet[a].add(b); adjSet[a].add(c);
    adjSet[b].add(a); adjSet[b].add(c);
    adjSet[c].add(a); adjSet[c].add(b);
  }
  const adj = adjSet.map((s) => Array.from(s));

  // vertex normals (angle-weighted)
  const normals = new Float32Array(V * 3);
  const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
  for (let t = 0; t < T; t++) {
    const ia = indices[t * 3], ib = indices[t * 3 + 1], ic = indices[t * 3 + 2];
    A[0] = positions[ia * 3]; A[1] = positions[ia * 3 + 1]; A[2] = positions[ia * 3 + 2];
    B[0] = positions[ib * 3]; B[1] = positions[ib * 3 + 1]; B[2] = positions[ib * 3 + 2];
    C[0] = positions[ic * 3]; C[1] = positions[ic * 3 + 1]; C[2] = positions[ic * 3 + 2];
    const fn = v3norm(v3cross(v3sub(B, A), v3sub(C, A)));
    // angle-weight (Voronoi-area-weighted normals are smoother)
    const e0 = v3norm(v3sub(B, A)), e1 = v3norm(v3sub(C, A));
    const e2 = v3norm(v3sub(A, B)), e3 = v3norm(v3sub(C, B));
    const e4 = v3norm(v3sub(A, C)), e5 = v3norm(v3sub(B, C));
    const aA = Math.acos(Math.max(-1, Math.min(1, v3dot(e0, e1))));
    const aB = Math.acos(Math.max(-1, Math.min(1, v3dot(e2, e3))));
    const aC = Math.acos(Math.max(-1, Math.min(1, v3dot(e4, e5))));
    normals[ia * 3] += fn[0] * aA; normals[ia * 3 + 1] += fn[1] * aA; normals[ia * 3 + 2] += fn[2] * aA;
    normals[ib * 3] += fn[0] * aB; normals[ib * 3 + 1] += fn[1] * aB; normals[ib * 3 + 2] += fn[2] * aB;
    normals[ic * 3] += fn[0] * aC; normals[ic * 3 + 1] += fn[1] * aC; normals[ic * 3 + 2] += fn[2] * aC;
  }
  for (let i = 0; i < V; i++) {
    const n = v3norm([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]]);
    normals[i * 3] = n[0]; normals[i * 3 + 1] = n[1]; normals[i * 3 + 2] = n[2];
  }
  return { adj, normals };
}

// ─── Local tangent frames ────────────────────────────────────────────
// Per vertex, build (e1, e2) orthonormal to the normal. The choice of e1
// is arbitrary but DETERMINISTIC (pick the world axis least aligned with
// the normal, project away).

export function buildTangentFrames(normals) {
  const V = (normals.length / 3) | 0;
  const e1 = new Float32Array(V * 3);
  const e2 = new Float32Array(V * 3);
  for (let i = 0; i < V; i++) {
    const n = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
    // ref axis: world axis least aligned with n
    const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
    let ref;
    if (ax <= ay && ax <= az) ref = [1, 0, 0];
    else if (ay <= az) ref = [0, 1, 0];
    else ref = [0, 0, 1];
    let t1 = v3sub(ref, v3scale(n, v3dot(ref, n)));
    const l = v3len(t1);
    if (l < 1e-8) {
      // fallback: rotate by 90° around any axis
      t1 = v3norm([n[1] - n[2], n[2] - n[0], n[0] - n[1]]);
    } else {
      t1 = v3scale(t1, 1 / l);
    }
    const t2 = v3norm(v3cross(n, t1));
    e1[i * 3] = t1[0]; e1[i * 3 + 1] = t1[1]; e1[i * 3 + 2] = t1[2];
    e2[i * 3] = t2[0]; e2[i * 3 + 1] = t2[1]; e2[i * 3 + 2] = t2[2];
  }
  return { e1, e2 };
}

// ─── Principal-curvature direction per vertex ────────────────────────
// Returns Float64Array `theta` length V, where theta[i] is the maximum
// principal direction's angle in the local (e1, e2) tangent frame.

export function estimateCrossField(positions, indices, adj, normals, e1, e2) {
  const V = (positions.length / 3) | 0;
  const theta = new Float64Array(V);
  const M3a = new Float64Array(9), M3b = new Float64Array(3); // 3x3 + rhs
  for (let i = 0; i < V; i++) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
    const n = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
    const t1 = [e1[i * 3], e1[i * 3 + 1], e1[i * 3 + 2]];
    const t2 = [e2[i * 3], e2[i * 3 + 1], e2[i * 3 + 2]];
    const neigh = adj[i];
    // For each neighbour j, write
    //   h_j = ½ S11 u² + ½ S22 v² + S12 u v
    // where (u, v, h) = (t1·d, t2·d, n·d), d = p_j - p_i.
    // The normal equations are 3×3 in (S11, S22, S12).
    // M[k][m] = Σ_j A_{j,k} A_{j,m}  with A_{j} = (½u², ½v², u·v)
    for (let k = 0; k < 9; k++) M3a[k] = 0;
    M3b[0] = M3b[1] = M3b[2] = 0;
    let n_valid = 0;
    for (let nk = 0; nk < neigh.length; nk++) {
      const j = neigh[nk];
      const dx = positions[j * 3] - px, dy = positions[j * 3 + 1] - py, dz = positions[j * 3 + 2] - pz;
      const u = t1[0] * dx + t1[1] * dy + t1[2] * dz;
      const v = t2[0] * dx + t2[1] * dy + t2[2] * dz;
      const h = n[0] * dx + n[1] * dy + n[2] * dz;
      const a0 = 0.5 * u * u, a1 = 0.5 * v * v, a2 = u * v;
      M3a[0] += a0 * a0; M3a[1] += a0 * a1; M3a[2] += a0 * a2;
      M3a[3] += a1 * a0; M3a[4] += a1 * a1; M3a[5] += a1 * a2;
      M3a[6] += a2 * a0; M3a[7] += a2 * a1; M3a[8] += a2 * a2;
      M3b[0] += a0 * h; M3b[1] += a1 * h; M3b[2] += a2 * h;
      n_valid++;
    }
    if (n_valid < 3) { theta[i] = 0; continue; }
    // Solve 3×3 with Cramer's rule (small + closed form).
    const det = M3a[0] * (M3a[4] * M3a[8] - M3a[5] * M3a[7])
              - M3a[1] * (M3a[3] * M3a[8] - M3a[5] * M3a[6])
              + M3a[2] * (M3a[3] * M3a[7] - M3a[4] * M3a[6]);
    if (Math.abs(det) < 1e-18) { theta[i] = 0; continue; }
    const detS11 = M3b[0] * (M3a[4] * M3a[8] - M3a[5] * M3a[7])
                 - M3a[1] * (M3b[1] * M3a[8] - M3a[5] * M3b[2])
                 + M3a[2] * (M3b[1] * M3a[7] - M3a[4] * M3b[2]);
    const detS22 = M3a[0] * (M3b[1] * M3a[8] - M3a[5] * M3b[2])
                 - M3b[0] * (M3a[3] * M3a[8] - M3a[5] * M3a[6])
                 + M3a[2] * (M3a[3] * M3b[2] - M3b[1] * M3a[6]);
    const detS12 = M3a[0] * (M3a[4] * M3b[2] - M3b[1] * M3a[7])
                 - M3a[1] * (M3a[3] * M3b[2] - M3b[1] * M3a[6])
                 + M3b[0] * (M3a[3] * M3a[7] - M3a[4] * M3a[6]);
    const S11 = detS11 / det, S22 = detS22 / det, S12 = detS12 / det;
    // Eigen-decomposition of 2×2 symmetric S.
    const tr = S11 + S22;
    const disc = Math.sqrt(Math.max(0, (S11 - S22) * (S11 - S22) + 4 * S12 * S12));
    const lam1 = (tr + disc) / 2, lam2 = (tr - disc) / 2;
    const lamMax = Math.abs(lam1) >= Math.abs(lam2) ? lam1 : lam2;
    // Eigenvector for lamMax: (S12, lamMax - S11) or (lamMax - S22, S12)
    let a = S12, b = lamMax - S11;
    if (Math.abs(a) + Math.abs(b) < 1e-9) { a = lamMax - S22; b = S12; }
    if (Math.abs(a) + Math.abs(b) < 1e-9) { a = 1; b = 0; }
    theta[i] = Math.atan2(b, a);
  }
  return theta;
}

// ─── Parallel transport between adjacent tangent frames ──────────────
// Given an angle θ_j defined in vertex j's local frame, return the
// equivalent angle in vertex i's local frame. We rotate j's frame onto
// i's frame using the SMALLEST-ROTATION (Rodrigues) parallel transport
// between the two normals — that's the correct discrete connection on
// a triangle mesh for direction-field transport.

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

export function transportAngle(thetaJ, nI, e1I, e2I, nJ, e1J, e2J) {
  // 1) Direction vector of θ_j in 3D (in j's tangent plane).
  const cj = Math.cos(thetaJ), sj = Math.sin(thetaJ);
  const dJ = [
    e1J[0] * cj + e2J[0] * sj,
    e1J[1] * cj + e2J[1] * sj,
    e1J[2] * cj + e2J[2] * sj,
  ];
  // 2) Smallest rotation from nJ → nI (Rodrigues).
  const axis = v3cross(nJ, nI);
  const al = v3len(axis);
  let dRot;
  if (al < 1e-9) {
    // Either parallel (no rotation) or antiparallel (180° — pick any
    // axis perpendicular to nJ).
    if (v3dot(nJ, nI) > 0) dRot = dJ;
    else {
      // Antiparallel — rotate 180° around e1J (which is ⊥ to nJ).
      const a2 = v3norm(e1J);
      dRot = rotateVecByAxisAngle(dJ, a2, Math.PI);
    }
  } else {
    const ax = v3scale(axis, 1 / al);
    const ang = Math.atan2(al, v3dot(nJ, nI));
    dRot = rotateVecByAxisAngle(dJ, ax, ang);
  }
  // 3) Project dRot onto i's tangent plane and read off its angle.
  const u = dRot[0] * e1I[0] + dRot[1] * e1I[1] + dRot[2] * e1I[2];
  const v = dRot[0] * e2I[0] + dRot[1] * e2I[1] + dRot[2] * e2I[2];
  return Math.atan2(v, u);
}

// ─── RoSy-4 symmetric smoothing ──────────────────────────────────────
// 4-RoSy: field is invariant under +π/2 rotation. To smooth, average
// exp(i·4·θ_j) over the 1-ring with neighbours parallel-transported
// into the local frame, then arg(·) / 4.

export function smoothRoSy4(theta, adj, normals, e1, e2, iters) {
  const V = theta.length;
  let cur = theta.slice();
  const next = new Float64Array(V);
  for (let it = 0; it < (iters || 8); it++) {
    for (let i = 0; i < V; i++) {
      const nI = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
      const e1I = [e1[i * 3], e1[i * 3 + 1], e1[i * 3 + 2]];
      const e2I = [e2[i * 3], e2[i * 3 + 1], e2[i * 3 + 2]];
      let cx = Math.cos(4 * cur[i]);
      let cy = Math.sin(4 * cur[i]);
      const neigh = adj[i];
      for (let k = 0; k < neigh.length; k++) {
        const j = neigh[k];
        const nJ = [normals[j * 3], normals[j * 3 + 1], normals[j * 3 + 2]];
        const e1J = [e1[j * 3], e1[j * 3 + 1], e1[j * 3 + 2]];
        const e2J = [e2[j * 3], e2[j * 3 + 1], e2[j * 3 + 2]];
        const a = transportAngle(cur[j], nI, e1I, e2I, nJ, e1J, e2J);
        cx += Math.cos(4 * a);
        cy += Math.sin(4 * a);
      }
      next[i] = Math.atan2(cy, cx) / 4;
    }
    [cur, ] = [next.slice(), cur];
  }
  return cur;
}

// ─── Singularity detection ──────────────────────────────────────────
// Walk each vertex's 1-ring counter-clockwise (in tangent plane order)
// and accumulate the signed angle jump between consecutive
// parallel-transported neighbour field directions, each wrapped into
// (-π/4, π/4]. The sum modulo π/2 is the period jump:
//   0  → regular vertex
//  +π/2 → 3-valent (negative index)
//  −π/2 → 5-valent (positive index)
// We expose it as `index` ∈ {-1, 0, +1} (units of π/2).

function angleInLocalFrame2D(dx, dy, dz, e1I, e2I) {
  const u = dx * e1I[0] + dy * e1I[1] + dz * e1I[2];
  const v = dx * e2I[0] + dy * e2I[1] + dz * e2I[2];
  return Math.atan2(v, u);
}

function wrapToHalfPi2(x) {
  // wrap into (-π/4, π/4]
  const q = Math.PI / 2;
  let y = x - q * Math.round(x / q);
  if (y <= -q / 2) y += q;
  if (y > q / 2) y -= q;
  return y;
}

export function findSingularities(positions, theta, adj, normals, e1, e2) {
  const V = theta.length;
  const out = [];
  for (let i = 0; i < V; i++) {
    const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
    const nI = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
    const e1I = [e1[i * 3], e1[i * 3 + 1], e1[i * 3 + 2]];
    const e2I = [e2[i * 3], e2[i * 3 + 1], e2[i * 3 + 2]];
    const neigh = adj[i];
    if (neigh.length < 3) continue;
    // Sort neighbours counter-clockwise by angle in (e1I, e2I).
    const ordered = neigh.map((j) => {
      const dx = positions[j * 3] - px;
      const dy = positions[j * 3 + 1] - py;
      const dz = positions[j * 3 + 2] - pz;
      return { j, ang: angleInLocalFrame2D(dx, dy, dz, e1I, e2I) };
    }).sort((A, B) => A.ang - B.ang);
    // Sum the transported field jumps around the ring (each wrapped
    // into (-π/4, π/4]).
    let totalJump = 0;
    let prevA = null;
    for (let k = 0; k < ordered.length; k++) {
      const j = ordered[k].j;
      const nJ = [normals[j * 3], normals[j * 3 + 1], normals[j * 3 + 2]];
      const e1J = [e1[j * 3], e1[j * 3 + 1], e1[j * 3 + 2]];
      const e2J = [e2[j * 3], e2[j * 3 + 1], e2[j * 3 + 2]];
      const a = transportAngle(theta[j], nI, e1I, e2I, nJ, e1J, e2J);
      if (prevA !== null) totalJump += wrapToHalfPi2(a - prevA);
      prevA = a;
    }
    // Close the ring back to the first neighbour to make it a closed
    // sum.
    if (ordered.length > 0) {
      const j0 = ordered[0].j;
      const nJ = [normals[j0 * 3], normals[j0 * 3 + 1], normals[j0 * 3 + 2]];
      const e1J = [e1[j0 * 3], e1[j0 * 3 + 1], e1[j0 * 3 + 2]];
      const e2J = [e2[j0 * 3], e2[j0 * 3 + 1], e2[j0 * 3 + 2]];
      const a0 = transportAngle(theta[j0], nI, e1I, e2I, nJ, e1J, e2J);
      if (prevA !== null) totalJump += wrapToHalfPi2(a0 - prevA);
    }
    // Round to nearest π/2; the integer count is the singularity INDEX.
    const idx = Math.round(totalJump / (Math.PI / 2));
    if (idx !== 0) {
      out.push({
        vertex: i,
        index: idx, // ±1 typical; ±π/2 jumps
        jump: totalJump,
        position: [px, py, pz],
      });
    }
  }
  return out;
}

// ─── End-to-end convenience ──────────────────────────────────────────

export function computeCrossField(positions, indices, opts) {
  const o = opts || {};
  const { adj, normals } = buildAdjacency(positions, indices);
  const { e1, e2 } = buildTangentFrames(normals);
  let theta = estimateCrossField(positions, indices, adj, normals, e1, e2);
  theta = smoothRoSy4(theta, adj, normals, e1, e2, o.smoothIters != null ? o.smoothIters : 12);
  const singularities = findSingularities(positions, theta, adj, normals, e1, e2);
  return { theta, adj, normals, e1, e2, singularities };
}
