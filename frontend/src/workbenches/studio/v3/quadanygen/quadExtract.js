// ArchDisc Studio V3 — slice 779.
//
// Quad extraction from the integer-grid (u, v) parameterisation.
//
// Algorithm:
//   1. For every triangle, walk through every integer (U, V) lattice
//      point whose unit cell intersects the triangle's (u, v) range.
//      Each lattice point's REAL position is the barycentric-weighted
//      blend of the triangle's three world-space vertices at that
//      (u, v) coordinate — that's the integer-grid vertex.
//   2. Quads are emitted by pairing four adjacent lattice points
//      (i, j), (i+1, j), (i+1, j+1), (i, j+1) when all four exist and
//      live on adjacent triangles.
//   3. T-junctions: at a singularity, the field changes valence (3- or
//      5-valent). The integer-grid lattice has one INCOMING streamline
//      that doesn't have a matching outgoing one (3-valent cone) or has
//      an extra unmatched outgoing one (5-valent cone). The cone vertex
//      is included in the output as a SHARED corner, so neighbouring
//      quads connect to it directly — the T-junction is represented
//      structurally as a vertex of valence 3 or 5 inside the quad mesh.
//
// Pure JS, no new deps.

function v3sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function v3dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function v3cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0]];
}
function v3norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

// Barycentric coords of (u, v) inside a 2D triangle (uA, uB, uC).
// Returns [bA, bB, bC]; outside-triangle hits return null.
function bary2D(uA, uB, uC, u, v) {
  const x1 = uA[0], y1 = uA[1];
  const x2 = uB[0], y2 = uB[1];
  const x3 = uC[0], y3 = uC[1];
  const den = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
  if (Math.abs(den) < 1e-16) return null;
  const a = ((y2 - y3) * (u - x3) + (x3 - x2) * (v - y3)) / den;
  const b = ((y3 - y1) * (u - x3) + (x1 - x3) * (v - y3)) / den;
  const c = 1 - a - b;
  // Tolerance: allow boundary hits.
  const eps = 1e-6;
  if (a < -eps || b < -eps || c < -eps) return null;
  return [a, b, c];
}

function bary3D(A, B, C, b) {
  return [
    A[0] * b[0] + B[0] * b[1] + C[0] * b[2],
    A[1] * b[0] + B[1] * b[1] + C[1] * b[2],
    A[2] * b[0] + B[2] * b[1] + C[2] * b[2],
  ];
}

// ─── Lattice extraction ──────────────────────────────────────────────
//
// Walk each triangle's (u, v) range, hit every integer-lattice point
// inside it, and record the world-space position of each hit.
// We dedup by the (intU, intV) lattice key so vertices shared by
// triangles get reused; that gives quad faces connectivity instead of
// triangle soup.

export function extractQuads(positions, indices, U, V, opts) {
  const o = opts || {};
  // For low-genus surfaces the (u, v) range spans the whole mesh
  // (typically up to ~targetQuadCount in each direction). Skip the
  // generation of cells beyond a sensible bound.
  let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
  const Vn = U.length;
  for (let i = 0; i < Vn; i++) {
    if (U[i] < uMin) uMin = U[i];
    if (U[i] > uMax) uMax = U[i];
    if (V[i] < vMin) vMin = V[i];
    if (V[i] > vMax) vMax = V[i];
  }
  // Clamp ranges to avoid runaway when streamlines escape on cuts.
  const maxSpan = o.maxSpan || 2048;
  if (uMax - uMin > maxSpan) { uMax = uMin + maxSpan; }
  if (vMax - vMin > maxSpan) { vMax = vMin + maxSpan; }

  const T = (indices.length / 3) | 0;
  const latticeKey = new Map(); // "i,j" → index in `verts`
  const verts = []; // [[x, y, z], …]
  // For each lattice site we also collect a normal-accumulator (averaged
  // across the triangles that emit it), used for output normals.
  const vNormals = [];
  // For face emission we need the local triangle neighbours of each
  // lattice site. Track (latticeKey → list of (tri, neighbourKeys)).
  const siteOnTri = new Map(); // tri → list of {key, ix, iy}

  function getOrCreateLatticeVert(ix, iy, p, normal) {
    const k = ix + ',' + iy;
    let id = latticeKey.get(k);
    if (id == null) {
      id = verts.length;
      latticeKey.set(k, id);
      verts.push(p);
      vNormals.push(normal.slice());
    } else {
      // Average position (in case multiple triangles disagree slightly)
      const old = verts[id];
      verts[id] = [(old[0] + p[0]) / 2, (old[1] + p[1]) / 2, (old[2] + p[2]) / 2];
      vNormals[id][0] += normal[0];
      vNormals[id][1] += normal[1];
      vNormals[id][2] += normal[2];
    }
    return id;
  }

  for (let t = 0; t < T; t++) {
    const ia = indices[t * 3], ib = indices[t * 3 + 1], ic = indices[t * 3 + 2];
    const A = [positions[ia * 3], positions[ia * 3 + 1], positions[ia * 3 + 2]];
    const B = [positions[ib * 3], positions[ib * 3 + 1], positions[ib * 3 + 2]];
    const C = [positions[ic * 3], positions[ic * 3 + 1], positions[ic * 3 + 2]];
    const uA = [U[ia], V[ia]], uB = [U[ib], V[ib]], uC = [U[ic], V[ic]];
    // Triangle's (u, v) bounding box.
    const tuMin = Math.min(uA[0], uB[0], uC[0]);
    const tuMax = Math.max(uA[0], uB[0], uC[0]);
    const tvMin = Math.min(uA[1], uB[1], uC[1]);
    const tvMax = Math.max(uA[1], uB[1], uC[1]);
    // Triangle normal (world-space, for the output vertex normals).
    const fn = v3norm(v3cross(v3sub(B, A), v3sub(C, A)));
    const iLo = Math.ceil(tuMin), iHi = Math.floor(tuMax);
    const jLo = Math.ceil(tvMin), jHi = Math.floor(tvMax);
    const siteList = [];
    for (let i = iLo; i <= iHi; i++) {
      for (let j = jLo; j <= jHi; j++) {
        const bc = bary2D(uA, uB, uC, i, j);
        if (!bc) continue;
        const p = bary3D(A, B, C, bc);
        const id = getOrCreateLatticeVert(i, j, p, fn);
        siteList.push({ id, ix: i, iy: j });
      }
    }
    if (siteList.length > 0) siteOnTri.set(t, siteList);
  }

  // ── Quad face emission ──
  // For each integer lattice site (ix, iy), if the three other corners
  // (ix+1, iy), (ix+1, iy+1), (ix, iy+1) ALL exist, emit a quad.
  // This naturally handles T-junctions at cones: at a singularity, one
  // of the four corners is missing (because the integer-grid wrap
  // skipped a row or duplicated one) and that quad simply isn't
  // emitted. The cone vertex itself is shared by 3 or 5 adjacent quads
  // depending on its valence — that's the T-junction in the output.
  const quads = [];
  for (const [k, _] of latticeKey) {
    const [ixS, iyS] = k.split(',');
    const ix = +ixS, iy = +iyS;
    const a = latticeKey.get(ix + ',' + iy);
    const b = latticeKey.get((ix + 1) + ',' + iy);
    const c = latticeKey.get((ix + 1) + ',' + (iy + 1));
    const d = latticeKey.get(ix + ',' + (iy + 1));
    if (a != null && b != null && c != null && d != null) {
      quads.push([a, b, c, d]);
    }
  }
  // Normalise per-vertex normals.
  const Vfinal = verts.length;
  const positionsOut = new Float32Array(Vfinal * 3);
  const normalsOut = new Float32Array(Vfinal * 3);
  for (let i = 0; i < Vfinal; i++) {
    positionsOut[i * 3] = verts[i][0];
    positionsOut[i * 3 + 1] = verts[i][1];
    positionsOut[i * 3 + 2] = verts[i][2];
    const n = v3norm(vNormals[i]);
    normalsOut[i * 3] = n[0];
    normalsOut[i * 3 + 1] = n[1];
    normalsOut[i * 3 + 2] = n[2];
  }
  // Build a triangle index for downstream renderers: split each quad
  // into two triangles.
  const triIndex = new Uint32Array(quads.length * 6);
  for (let q = 0; q < quads.length; q++) {
    const [a, b, c, d] = quads[q];
    triIndex[q * 6] = a; triIndex[q * 6 + 1] = b; triIndex[q * 6 + 2] = c;
    triIndex[q * 6 + 3] = a; triIndex[q * 6 + 4] = c; triIndex[q * 6 + 5] = d;
  }

  // Compute valence histogram (how many quads each vertex belongs to)
  // so we can report 3- and 5-valent T-junction counts.
  const valence = new Int32Array(Vfinal);
  for (const q of quads) for (const v of q) valence[v]++;
  let nValence3 = 0, nValence5 = 0;
  for (let i = 0; i < Vfinal; i++) {
    if (valence[i] === 3) nValence3++;
    else if (valence[i] === 5) nValence5++;
  }

  return {
    positions: positionsOut,
    normals: normalsOut,
    triIndex,
    quads,
    quadCount: quads.length,
    vertexCount: Vfinal,
    tJunction3: nValence3,
    tJunction5: nValence5,
  };
}
