// Slice 763 — Laplacian UV relax preserving boundary.
//
// Maya UV Editor "Relax UVs" and Blender UV Editor "Minimize Stretch"
// both iterate the same fix: for each interior UV vertex, replace its
// UV with the average of its mesh-edge neighbours' UVs. Boundary
// vertices (those on the open border of an island — edges shared by
// only one triangle in the mesh) are held fixed so the relax doesn't
// collapse the chart.
//
// `strength` blends the new position back with the old (0 → no move,
// 1 → full move). `iterations` runs multiple Jacobi sweeps.
//
// Pure JS; works on any BufferGeometry that has a UV attribute.

export function relaxUVs(geometry, iterations, strength) {
  const uv = geometry?.attributes?.uv;
  const pos = geometry?.attributes?.position;
  if (!uv || !pos) return false;
  const idx = geometry.index ? geometry.index.array : null;
  const N = pos.count;
  const triCount = idx ? idx.length / 3 : N / 3;
  if (triCount < 1) return false;
  const it = Math.max(1, Math.min(200, Number(iterations) || 5));
  const s = Math.max(0, Math.min(1, Number(strength) || 0.5));

  // Build undirected vertex-vertex neighbour set and per-edge tri-count
  // so we can flag boundary verts (verts touching an edge with only one
  // adjacent tri). We canonicalise an edge as the sorted (lo,hi) pair.
  const neighbours = new Array(N);
  for (let i = 0; i < N; i++) neighbours[i] = new Set();
  const edgeTri = new Map();
  const edgeKey = (a, b) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (let t = 0; t < triCount; t++) {
    const a = idx ? idx[t * 3]     : t * 3;
    const b = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const c = idx ? idx[t * 3 + 2] : t * 3 + 2;
    neighbours[a].add(b); neighbours[a].add(c);
    neighbours[b].add(a); neighbours[b].add(c);
    neighbours[c].add(a); neighbours[c].add(b);
    for (const [x, y] of [[a, b], [b, c], [c, a]]) {
      const k = edgeKey(x, y);
      edgeTri.set(k, (edgeTri.get(k) || 0) + 1);
    }
  }
  // Boundary verts: any vert that touches an edge belonging to only ONE
  // triangle. Those are the open chart borders.
  const isBoundary = new Uint8Array(N);
  for (const [k, c] of edgeTri.entries()) {
    if (c === 1) {
      const sep = k.indexOf(':');
      isBoundary[Number(k.slice(0, sep))] = 1;
      isBoundary[Number(k.slice(sep + 1))] = 1;
    }
  }

  const arr = uv.array;
  const tmp = new Float32Array(arr.length);
  for (let iter = 0; iter < it; iter++) {
    tmp.set(arr);
    for (let v = 0; v < N; v++) {
      if (isBoundary[v]) continue;
      let su = 0, sv = 0, n = 0;
      for (const nb of neighbours[v]) {
        su += arr[nb * 2];
        sv += arr[nb * 2 + 1];
        n++;
      }
      if (!n) continue;
      const tu = su / n, tv = sv / n;
      tmp[v * 2]     = arr[v * 2]     + (tu - arr[v * 2])     * s;
      tmp[v * 2 + 1] = arr[v * 2 + 1] + (tv - arr[v * 2 + 1]) * s;
    }
    arr.set(tmp);
  }
  uv.needsUpdate = true;
  return true;
}
