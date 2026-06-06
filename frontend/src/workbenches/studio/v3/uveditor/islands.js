// Slice 763 — UV-island ops for the real-time UV editor.
//
// Maya UV Editor / Blender UV Editor parity: a UV "island" is a maximal
// set of triangles whose UV coordinates are connected — sharing a UV
// edge means sharing TWO vertex indices in the index buffer (NOT
// proximity in UV space — coincident UVs that come from different mesh
// edges still belong to separate islands once a seam cuts the chart).
//
// Per-island transforms (move / rotate / scale / mirror) pivot around
// the island centroid by default so the visual centre stays put under
// non-uniform xforms (matches Maya's "Around Selection Center" UV mode
// and Blender's "Median Point" pivot).
//
// Greedy first-fit-decreasing bin-pack into [0,1]² with a configurable
// margin. After laying every island down, we down-scale globally so the
// occupied bbox fits inside the unit square if we overflowed.
//
// Pure JS, no deps beyond what's already imported by the caller. All
// functions take a `THREE.BufferGeometry` so we can be used both by the
// op-bound window surface and by direct callers.

// Build a per-island index → list of triangle indices. UV adjacency is
// driven by VERTEX-INDEX equality so a triangle's three corners on the
// shared edge of a chart are treated as one island. A mesh whose seams
// have been cut (separate vertex copies on each side) naturally splits
// into the expected charts.
//
// Each returned island record also caches its UV bbox so callers (and
// `islandBoundingBox`) don't have to scan the UV buffer again.
export function findIslands(geometry) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return [];
  const idx = geometry.index ? geometry.index.array : null;
  const posCount = geometry.attributes.position.count;
  const triCount = idx ? idx.length / 3 : posCount / 3;
  if (triCount < 1) return [];
  // Build vertex-shared triangle adjacency via vertex→tri buckets.
  const vertToTris = new Map();
  const triVerts = new Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx[t * 3]     : t * 3;
    const b = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const c = idx ? idx[t * 3 + 2] : t * 3 + 2;
    triVerts[t] = [a, b, c];
    for (let k = 0; k < 3; k++) {
      const v = triVerts[t][k];
      let arr = vertToTris.get(v);
      if (!arr) { arr = []; vertToTris.set(v, arr); }
      arr.push(t);
    }
  }
  const triIsland = new Int32Array(triCount).fill(-1);
  const uvArr = geometry.attributes.uv ? geometry.attributes.uv.array : null;
  let nextId = 0;
  const islands = [];
  for (let seed = 0; seed < triCount; seed++) {
    if (triIsland[seed] !== -1) continue;
    const id = nextId++;
    const stack = [seed];
    triIsland[seed] = id;
    const tris = [];
    const verts = new Set();
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    while (stack.length) {
      const t = stack.pop();
      tris.push(t);
      for (let k = 0; k < 3; k++) {
        const v = triVerts[t][k];
        if (!verts.has(v) && uvArr) {
          const u = uvArr[v * 2], w = uvArr[v * 2 + 1];
          if (u < minU) minU = u; if (u > maxU) maxU = u;
          if (w < minV) minV = w; if (w > maxV) maxV = w;
        }
        verts.add(v);
        const bucket = vertToTris.get(v) || [];
        for (let i = 0; i < bucket.length; i++) {
          const nt = bucket[i];
          if (triIsland[nt] === -1) {
            triIsland[nt] = id;
            stack.push(nt);
          }
        }
      }
    }
    const bbox = Number.isFinite(minU)
      ? { min: [minU, minV], max: [maxU, maxV] }
      : { min: [0, 0], max: [0, 0] };
    islands.push({ id, triIndices: tris, vertSet: verts, bbox });
  }
  return islands;
}

// Axis-aligned UV bbox of an island record produced by `findIslands`.
// (Cached on the record so this is O(1).)
export function islandBoundingBox(island) {
  if (!island || !island.bbox) return { min: [0, 0], max: [0, 0] };
  return { min: [island.bbox.min[0], island.bbox.min[1]],
           max: [island.bbox.max[0], island.bbox.max[1]] };
}

// Helper — fetch the island record by id.
function _islandById(geometry, islandId) {
  const islands = findIslands(geometry);
  return islands.find((i) => i.id === islandId) || null;
}

// Helper — return the centroid of an island's UVs.
function _islandCentroid(geometry, island) {
  const uv = geometry.attributes.uv.array;
  let su = 0, sv = 0, n = 0;
  for (const v of island.vertSet) {
    su += uv[v * 2];
    sv += uv[v * 2 + 1];
    n++;
  }
  return n ? [su / n, sv / n] : [0, 0];
}

// Translate every UV vertex in the island by (du, dv).
export function moveIsland(geometry, islandId, du, dv) {
  const uv = geometry?.attributes?.uv;
  if (!uv) return false;
  const isl = _islandById(geometry, islandId);
  if (!isl) return false;
  const arr = uv.array;
  for (const v of isl.vertSet) {
    arr[v * 2]     += du;
    arr[v * 2 + 1] += dv;
  }
  uv.needsUpdate = true;
  return true;
}

// Rotate every UV vertex in the island around `pivot` by `angle` radians.
// If `pivot` is null, use the island centroid.
export function rotateIsland(geometry, islandId, angle, pivot) {
  const uv = geometry?.attributes?.uv;
  if (!uv) return false;
  const isl = _islandById(geometry, islandId);
  if (!isl) return false;
  const p = pivot || _islandCentroid(geometry, isl);
  const c = Math.cos(angle), s = Math.sin(angle);
  const arr = uv.array;
  for (const v of isl.vertSet) {
    const u = arr[v * 2]     - p[0];
    const w = arr[v * 2 + 1] - p[1];
    arr[v * 2]     = p[0] + (u * c - w * s);
    arr[v * 2 + 1] = p[1] + (u * s + w * c);
  }
  uv.needsUpdate = true;
  return true;
}

// Scale UVs by (sx, sy) around `pivot` (or centroid if null).
export function scaleIsland(geometry, islandId, sx, sy, pivot) {
  const uv = geometry?.attributes?.uv;
  if (!uv) return false;
  const isl = _islandById(geometry, islandId);
  if (!isl) return false;
  const p = pivot || _islandCentroid(geometry, isl);
  const arr = uv.array;
  for (const v of isl.vertSet) {
    const u = arr[v * 2]     - p[0];
    const w = arr[v * 2 + 1] - p[1];
    arr[v * 2]     = p[0] + u * sx;
    arr[v * 2 + 1] = p[1] + w * sy;
  }
  uv.needsUpdate = true;
  return true;
}

// Mirror the island horizontally (`'x'` / `'u'`) or vertically
// (`'y'` / `'v'`) around its centroid. Also flips triangle winding in UV
// space — that's what callers expect for "Flip U" / "Flip V" parity.
export function mirrorIsland(geometry, islandId, axis) {
  const uv = geometry?.attributes?.uv;
  if (!uv) return false;
  const isl = _islandById(geometry, islandId);
  if (!isl) return false;
  const c = _islandCentroid(geometry, isl);
  const arr = uv.array;
  const flipU = (axis === 'x' || axis === 'u' || axis === 'h' || axis === 'horizontal');
  for (const v of isl.vertSet) {
    if (flipU) arr[v * 2]     = 2 * c[0] - arr[v * 2];
    else       arr[v * 2 + 1] = 2 * c[1] - arr[v * 2 + 1];
  }
  uv.needsUpdate = true;
  return true;
}

// Greedy first-fit-decreasing shelf-pack of every UV island into [0,1]²
// with a `margin` strip kept around each island. We sort islands by
// area (largest first), lay them down on shelves left-to-right, and
// down-scale the entire layout once at the end if it overflowed (so the
// relative ratio between islands is preserved — what Blender's "Pack
// Islands" does after re-margin).
export function packIslands(geometry, margin) {
  const uv = geometry?.attributes?.uv;
  if (!uv) return 0;
  const islands = findIslands(geometry);
  if (!islands.length) return 0;
  const m = Math.max(0, Number(margin) || 0);
  // Compute per-island bbox + working size (including margin).
  const recs = islands.map((isl) => {
    const bb = islandBoundingBox(isl);
    return {
      isl,
      srcMinU: bb.min[0], srcMinV: bb.min[1],
      w: (bb.max[0] - bb.min[0]) + 2 * m,
      h: (bb.max[1] - bb.min[1]) + 2 * m,
    };
  });
  // First-fit-decreasing by area.
  recs.sort((a, b) => (b.w * b.h) - (a.w * a.h));
  // Shelf placement. We track per-shelf "x cursor + height". If the
  // candidate doesn't fit horizontally on the current shelf, start a
  // new shelf below. shelfX/shelfY refer to the bottom-left of the next
  // island's MARGIN BOX — the island itself lands at (shelfX + m,
  // shelfY + m).
  const placements = [];
  let shelfY = 0;
  let shelfH = 0;
  let shelfX = 0;
  for (const r of recs) {
    if (shelfX + r.w > 1 + 1e-9 && shelfX > 1e-9) {
      shelfY += shelfH;
      shelfH = 0;
      shelfX = 0;
    }
    // Translation moves the source island's min into (shelfX + m,
    // shelfY + m). So newU = u - srcMinU + shelfX + m.
    placements.push({ r, tx: shelfX + m - r.srcMinU, ty: shelfY + m - r.srcMinV });
    shelfX += r.w;
    if (r.h > shelfH) shelfH = r.h;
  }
  // Final overflow check: did we run past the unit square in either
  // dim? If so, scale every placement uniformly so the bbox fits.
  // shelfX after the loop equals the rightmost edge of the last shelf
  // (which holds the widest run); per-shelf wraps reset it.
  let widestShelf = 0;
  {
    let x = 0, y = 0, h = 0;
    for (const r of recs) {
      if (x + r.w > 1 + 1e-9 && x > 1e-9) { if (x > widestShelf) widestShelf = x; y += h; h = 0; x = 0; }
      x += r.w;
      if (r.h > h) h = r.h;
    }
    if (x > widestShelf) widestShelf = x;
  }
  const totalH = shelfY + shelfH;
  const overrun = Math.max(widestShelf, totalH, 1);
  const scale = 1 / overrun;
  // Apply placements to the UV buffer.
  const arr = uv.array;
  for (const p of placements) {
    for (const v of p.r.isl.vertSet) {
      const u = arr[v * 2];
      const w = arr[v * 2 + 1];
      arr[v * 2]     = (u + p.tx) * scale;
      arr[v * 2 + 1] = (w + p.ty) * scale;
    }
  }
  uv.needsUpdate = true;
  return placements.length;
}
