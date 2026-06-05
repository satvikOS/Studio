// ArchDisc Studio V3 — Loop subdivision (Plasticity-style smooth cage).
//
// `loopSubdivide(positions, indices, { creases, levels })` runs the
// Loop subdivision scheme on a triangle mesh. Each iteration:
//
//   1. Welds positions to a unique-vertex table so logically-shared
//      verts share Loop weights even if the input has duplicates.
//   2. Builds the edge → adjacent-face table.
//   3. Emits one NEW "edge vertex" per unique edge using the Loop
//      edge mask:
//         • interior edge: (3/8)(v0 + v1) + (1/8)(opp0 + opp1)
//         • boundary edge: 0.5*(v0 + v1)
//         • creased edge (weight > 0): blend interior result with the
//           sharp midpoint by `creaseWeight` (1 → fully sharp).
//   4. Smooths every OLD vertex using the Loop vertex mask:
//         • interior n-valence vertex with non-creased ring:
//             β = (1/n) * (5/8 - (3/8 + 1/4 cos(2π/n))²)
//             v' = (1 - n·β) v + β Σ neighbours
//         • boundary vertex (n=2 boundary neighbours):
//             v' = (3/4) v + (1/8)(b0 + b1)
//         • when a vertex has ≥2 incident crease edges (incl boundary)
//           treat the two highest-weight crease neighbours as its
//           boundary support and blend the smooth/sharp positions by
//           the average incident crease weight.
//   5. Splits every old triangle into 4 sub-triangles using the
//      three edge midpoint vertices.
//   6. Propagates crease keys to the two halves of each subdivided
//      edge, preserving the original weight (so multi-level
//      subdivision keeps sharp creases sharp).
//
// Returns { positions: Float32Array, indices: Uint32Array,
//          creases: Map<edgeKey, weight> } so the surface wrapper can
// keep crease metadata in lockstep with the smoothed mesh.
//
// All arithmetic is plain JS — no THREE dependency, no allocations
// inside the hot loops beyond what's strictly necessary.

export function edgeKey(i, j) {
  return i < j ? `${i}:${j}` : `${j}:${i}`;
}

// Weld positions to a unique-vertex table within `eps`. Returns
//   { uniquePositions: Float32Array, remap: Uint32Array }
// where remap[origIdx] = uniqueIdx. We use a quantised hash for O(N).
function weldPositions(positions, eps = 1e-6) {
  const n = positions.length / 3;
  const remap = new Uint32Array(n);
  const bucket = new Map();
  const inv = 1 / eps;
  const unique = [];
  for (let i = 0; i < n; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const key = `${Math.round(x * inv)}|${Math.round(y * inv)}|${Math.round(z * inv)}`;
    let u = bucket.get(key);
    if (u === undefined) {
      u = unique.length / 3;
      unique.push(x, y, z);
      bucket.set(key, u);
    }
    remap[i] = u;
  }
  return { uniquePositions: new Float32Array(unique), remap };
}

// One Loop subdivision pass on welded data. Honors a `creases` map
// keyed by `edgeKey(i,j)` of welded indices.
function loopPass(positions, indices, creases) {
  const vc = positions.length / 3;
  const fc = indices.length / 3;

  // ─── adjacency tables ──────────────────────────────────────────────
  // edges: Map<edgeKey, { i, j, faces: [fid, fid?], oppVerts: [v, v?] }>
  const edges = new Map();
  // vertex neighbours (welded indices). Set for de-dup.
  const neighbours = Array.from({ length: vc }, () => new Set());

  for (let f = 0; f < fc; f++) {
    const a = indices[f * 3];
    const b = indices[f * 3 + 1];
    const c = indices[f * 3 + 2];
    const tri = [a, b, c];
    for (let e = 0; e < 3; e++) {
      const i = tri[e];
      const j = tri[(e + 1) % 3];
      const opp = tri[(e + 2) % 3];
      const k = edgeKey(i, j);
      let rec = edges.get(k);
      if (!rec) {
        rec = { i: Math.min(i, j), j: Math.max(i, j), faces: [], oppVerts: [] };
        edges.set(k, rec);
      }
      rec.faces.push(f);
      rec.oppVerts.push(opp);
      neighbours[i].add(j);
      neighbours[j].add(i);
    }
  }

  // Boundary edges have exactly one incident face.
  const boundary = new Set();
  for (const [k, rec] of edges) {
    if (rec.faces.length === 1) boundary.add(k);
  }
  // Vertex → list of crease/boundary edge keys it touches (with
  // weights). Boundary edges count as weight 1.
  const vertCreases = Array.from({ length: vc }, () => []);
  for (const [k, rec] of edges) {
    let w = 0;
    if (boundary.has(k)) w = 1;
    else if (creases && creases.has(k)) {
      const cw = creases.get(k);
      if (cw > 0) w = Math.min(1, cw);
    }
    if (w > 0) {
      vertCreases[rec.i].push({ k, other: rec.j, w });
      vertCreases[rec.j].push({ k, other: rec.i, w });
    }
  }

  // ─── new positions for OLD vertices (Loop vertex mask) ─────────────
  const newPositions = new Float32Array(positions.length);
  for (let v = 0; v < vc; v++) {
    const px = positions[v * 3];
    const py = positions[v * 3 + 1];
    const pz = positions[v * 3 + 2];

    const myCreases = vertCreases[v];
    const incidentCreaseCount = myCreases.length;

    let sx = px, sy = py, sz = pz; // default: hold position

    if (incidentCreaseCount >= 2) {
      // Crease/corner vertex. Two highest-weight crease neighbours
      // act as the boundary support; sharper with more creases.
      myCreases.sort((a, b) => b.w - a.w);
      const a = myCreases[0];
      const b = myCreases[1];
      const ax = positions[a.other * 3];
      const ay = positions[a.other * 3 + 1];
      const az = positions[a.other * 3 + 2];
      const bx = positions[b.other * 3];
      const by = positions[b.other * 3 + 1];
      const bz = positions[b.other * 3 + 2];
      // Loop crease mask: (3/4)v + (1/8)(a + b)
      const cx = 0.75 * px + 0.125 * (ax + bx);
      const cy = 0.75 * py + 0.125 * (ay + by);
      const cz = 0.75 * pz + 0.125 * (az + bz);

      if (incidentCreaseCount >= 3) {
        // Corner: lock position fully (≥3 creases = "fixed").
        sx = px; sy = py; sz = pz;
      } else {
        // Blend smooth/sharp by the average crease weight.
        const avgW = (a.w + b.w) * 0.5;
        // Compute smooth position via interior mask & blend.
        const nbrs = Array.from(neighbours[v]);
        const n = nbrs.length;
        if (n > 0) {
          const beta = n === 3
            ? 3 / 16
            : (1 / n) * (5 / 8 - Math.pow(3 / 8 + 0.25 * Math.cos((2 * Math.PI) / n), 2));
          let nx = 0, ny = 0, nz = 0;
          for (const u of nbrs) {
            nx += positions[u * 3];
            ny += positions[u * 3 + 1];
            nz += positions[u * 3 + 2];
          }
          const smX = (1 - n * beta) * px + beta * nx;
          const smY = (1 - n * beta) * py + beta * ny;
          const smZ = (1 - n * beta) * pz + beta * nz;
          sx = cx * avgW + smX * (1 - avgW);
          sy = cy * avgW + smY * (1 - avgW);
          sz = cz * avgW + smZ * (1 - avgW);
        } else {
          sx = cx; sy = cy; sz = cz;
        }
      }
    } else {
      // Pure interior — Loop's vertex mask.
      const nbrs = Array.from(neighbours[v]);
      const n = nbrs.length;
      if (n === 0) {
        // Isolated vertex (degenerate). Hold position.
        sx = px; sy = py; sz = pz;
      } else {
        const beta = n === 3
          ? 3 / 16
          : (1 / n) * (5 / 8 - Math.pow(3 / 8 + 0.25 * Math.cos((2 * Math.PI) / n), 2));
        let nx = 0, ny = 0, nz = 0;
        for (const u of nbrs) {
          nx += positions[u * 3];
          ny += positions[u * 3 + 1];
          nz += positions[u * 3 + 2];
        }
        sx = (1 - n * beta) * px + beta * nx;
        sy = (1 - n * beta) * py + beta * ny;
        sz = (1 - n * beta) * pz + beta * nz;
      }
    }
    newPositions[v * 3] = sx;
    newPositions[v * 3 + 1] = sy;
    newPositions[v * 3 + 2] = sz;
  }

  // ─── one NEW vertex per edge (Loop edge mask) ──────────────────────
  // edgeNewIndex: Map<edgeKey, newVertIdx>
  const edgeNewIndex = new Map();
  const edgePositionsList = []; // flat xyz
  let nextNewIdx = vc;

  for (const [k, rec] of edges) {
    const { i, j, oppVerts } = rec;
    const xi = positions[i * 3], yi = positions[i * 3 + 1], zi = positions[i * 3 + 2];
    const xj = positions[j * 3], yj = positions[j * 3 + 1], zj = positions[j * 3 + 2];
    let nx, ny, nz;
    const isBoundary = boundary.has(k);
    const cw = creases && creases.get(k) ? Math.min(1, creases.get(k)) : 0;

    if (isBoundary || oppVerts.length < 2) {
      // boundary edge midpoint
      nx = 0.5 * (xi + xj);
      ny = 0.5 * (yi + yj);
      nz = 0.5 * (zi + zj);
    } else {
      // interior edge — Loop mask
      const o0 = oppVerts[0], o1 = oppVerts[1];
      const xo0 = positions[o0 * 3], yo0 = positions[o0 * 3 + 1], zo0 = positions[o0 * 3 + 2];
      const xo1 = positions[o1 * 3], yo1 = positions[o1 * 3 + 1], zo1 = positions[o1 * 3 + 2];
      const sm = {
        x: 0.375 * (xi + xj) + 0.125 * (xo0 + xo1),
        y: 0.375 * (yi + yj) + 0.125 * (yo0 + yo1),
        z: 0.375 * (zi + zj) + 0.125 * (zo0 + zo1),
      };
      if (cw > 0) {
        const sharpX = 0.5 * (xi + xj);
        const sharpY = 0.5 * (yi + yj);
        const sharpZ = 0.5 * (zi + zj);
        nx = sm.x * (1 - cw) + sharpX * cw;
        ny = sm.y * (1 - cw) + sharpY * cw;
        nz = sm.z * (1 - cw) + sharpZ * cw;
      } else {
        nx = sm.x; ny = sm.y; nz = sm.z;
      }
    }
    edgeNewIndex.set(k, nextNewIdx++);
    edgePositionsList.push(nx, ny, nz);
  }

  // ─── combine OLD smoothed positions + NEW edge positions ───────────
  const totalVerts = vc + edgePositionsList.length / 3;
  const outPositions = new Float32Array(totalVerts * 3);
  outPositions.set(newPositions, 0);
  outPositions.set(edgePositionsList, vc * 3);

  // ─── new indices: each tri becomes 4 sub-tris ──────────────────────
  const outIndices = new Uint32Array(fc * 12);
  let ii = 0;
  for (let f = 0; f < fc; f++) {
    const a = indices[f * 3];
    const b = indices[f * 3 + 1];
    const c = indices[f * 3 + 2];
    const eAB = edgeNewIndex.get(edgeKey(a, b));
    const eBC = edgeNewIndex.get(edgeKey(b, c));
    const eCA = edgeNewIndex.get(edgeKey(c, a));
    // corner tris
    outIndices[ii++] = a; outIndices[ii++] = eAB; outIndices[ii++] = eCA;
    outIndices[ii++] = b; outIndices[ii++] = eBC; outIndices[ii++] = eAB;
    outIndices[ii++] = c; outIndices[ii++] = eCA; outIndices[ii++] = eBC;
    // centre tri
    outIndices[ii++] = eAB; outIndices[ii++] = eBC; outIndices[ii++] = eCA;
  }

  // ─── crease propagation ────────────────────────────────────────────
  // For each original edge i↔j with weight w (or boundary marker), the
  // subdivided halves are i↔eIJ and eIJ↔j. Both inherit the weight.
  // We also propagate the weight along an internal split when a
  // boundary edge has weight already; here only the explicit `creases`
  // map (not boundary inference) is carried forward.
  const outCreases = new Map();
  if (creases && creases.size) {
    for (const [k, w] of creases) {
      if (!(w > 0)) continue;
      const rec = edges.get(k);
      if (!rec) continue;
      const eIJ = edgeNewIndex.get(k);
      const k1 = edgeKey(rec.i, eIJ);
      const k2 = edgeKey(eIJ, rec.j);
      outCreases.set(k1, w);
      outCreases.set(k2, w);
    }
  }

  return { positions: outPositions, indices: outIndices, creases: outCreases };
}

// Public entry point: weld the cage, run `levels` Loop passes,
// returning the final smooth result + final crease map keyed on the
// indices of the welded RESULT (so the surface module can render them
// directly without re-welding).
export function loopSubdivide(positions, indices, opts = {}) {
  const levels = Math.max(0, Math.min(6, opts.levels | 0));
  const inCreases = opts.creases instanceof Map ? opts.creases : new Map();

  // Weld input cage once so duplicate verts in the input geometry
  // (e.g. from non-indexed Three primitives) participate in Loop
  // weighting as a single vertex.
  const welded = weldPositions(positions);
  const remappedIndices = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    remappedIndices[i] = welded.remap[indices[i]];
  }
  // Remap input crease keys (original indices) onto welded indices.
  const remappedCreases = new Map();
  for (const [k, w] of inCreases) {
    const [a, b] = k.split(':').map(Number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const ra = welded.remap[a] ?? a;
    const rb = welded.remap[b] ?? b;
    if (ra === rb) continue;
    remappedCreases.set(edgeKey(ra, rb), Math.min(1, Number(w) || 0));
  }

  let curPos = welded.uniquePositions;
  let curIdx = remappedIndices;
  let curCre = remappedCreases;

  for (let lv = 0; lv < levels; lv++) {
    const out = loopPass(curPos, curIdx, curCre);
    curPos = out.positions;
    curIdx = out.indices;
    curCre = out.creases;
  }

  return {
    positions: curPos,
    indices: curIdx,
    creases: curCre,
    levels,
  };
}

// Convenience: build a per-vertex normal Float32Array from a triangle
// soup so the surface wrapper can populate a normal attribute without
// pulling THREE into this file.
export function computeFlatNormals(positions, indices) {
  const out = new Float32Array(positions.length);
  for (let f = 0; f < indices.length; f += 3) {
    const a = indices[f], b = indices[f + 1], c = indices[f + 2];
    const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
    const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
    const cx = positions[c * 3], cy = positions[c * 3 + 1], cz = positions[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    out[a * 3] += nx; out[a * 3 + 1] += ny; out[a * 3 + 2] += nz;
    out[b * 3] += nx; out[b * 3 + 1] += ny; out[b * 3 + 2] += nz;
    out[c * 3] += nx; out[c * 3 + 1] += ny; out[c * 3 + 2] += nz;
  }
  // normalise
  for (let i = 0; i < out.length; i += 3) {
    const x = out[i], y = out[i + 1], z = out[i + 2];
    const m = Math.hypot(x, y, z) || 1;
    out[i] = x / m; out[i + 1] = y / m; out[i + 2] = z / m;
  }
  return out;
}

export default loopSubdivide;
