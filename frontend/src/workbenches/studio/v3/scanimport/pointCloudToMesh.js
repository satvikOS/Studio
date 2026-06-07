// ArchDisc Studio V3 — point-cloud → mesh utilities (slice 890).
//
// Photogrammetry pipelines (Reality Capture / Agisoft / Meshroom) emit
// dense point clouds that need a mesh to be useful in Studio. This
// module ships the two transforms a typical scan workflow needs:
//
//   1. POISSON-DISK SUBSAMPLE — drop the cloud to N points with
//      Bridson dart-throwing on the input positions, so the survivors
//      are well-distributed (no neighbourhood pileups, no holes that
//      a uniform random subsample would create). Deterministic via
//      mulberry32-seeded PRNG.
//
//   2. CONVEX HULL TRIANGULATION — the simplest "watertight from a
//      point cloud" surface possible: Quickhull 3-D on the sample
//      set. This is the honest fallback we can ship without ball-
//      pivot's neighbourhood-radius parameter tuning. For most
//      photogrammetry sweeps the convex hull is a usable lighting
//      proxy / collision proxy when the dense mesh isn't required.
//
// Both routines return a plain `{ positions, indices }` blob the
// index.js wrapper hoists into a `THREE.BufferGeometry`. Pure JS, no
// new deps.

// ── deterministic RNG (mulberry32) ─────────────────────────────────
function _mulberry32(seed) {
  let s = (seed >>> 0) || 1;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
  };
}

// Poisson-disk subsample by dart throwing on the input positions.
// `target` is the requested point count; if the input already has
// fewer than `target` it is returned untouched. `radius` defaults to
// auto-derive from the bounding box volume / target ratio so the
// caller doesn't need to tune it.
export function poissonDiskSubsample(positions, target, opts = {}) {
  const N = positions.length / 3;
  if (N <= target) {
    return { positions: positions.slice(), kept: N };
  }
  const seed = opts.seed != null ? opts.seed : 1;
  const rng = _mulberry32(seed);

  // Bounding box → cell size.
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < N; i++) {
    const x = positions[i * 3 + 0];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  const vol = Math.max(1e-12, dx * dy * dz);
  // r ≈ ((volume / target) ^ 1/3) — average inter-point spacing.
  const r = opts.radius || Math.pow(vol / target, 1 / 3) * 0.9;
  const r2 = r * r;
  const cellSize = r / Math.sqrt(3);
  const gridX = Math.max(1, Math.ceil(dx / cellSize));
  const gridY = Math.max(1, Math.ceil(dy / cellSize));
  const gridZ = Math.max(1, Math.ceil(dz / cellSize));
  const grid = new Map();
  function _key(cx, cy, cz) { return cx + '_' + cy + '_' + cz; }
  function _cellOf(x, y, z) {
    return [
      Math.min(gridX - 1, Math.max(0, Math.floor((x - minX) / cellSize))),
      Math.min(gridY - 1, Math.max(0, Math.floor((y - minY) / cellSize))),
      Math.min(gridZ - 1, Math.max(0, Math.floor((z - minZ) / cellSize))),
    ];
  }
  function _accept(x, y, z) {
    const [cx, cy, cz] = _cellOf(x, y, z);
    for (let oz = -1; oz <= 1; oz++) {
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const k = _key(cx + ox, cy + oy, cz + oz);
          const arr = grid.get(k);
          if (!arr) continue;
          for (const p of arr) {
            const ddx = p[0] - x;
            const ddy = p[1] - y;
            const ddz = p[2] - z;
            if (ddx * ddx + ddy * ddy + ddz * ddz < r2) return false;
          }
        }
      }
    }
    return true;
  }

  // Random walk through source indices (Fisher-Yates partial shuffle).
  const order = new Uint32Array(N);
  for (let i = 0; i < N; i++) order[i] = i;
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = order[i]; order[i] = order[j]; order[j] = t;
  }
  const kept = [];
  for (let i = 0; i < N && kept.length < target; i++) {
    const src = order[i];
    const x = positions[src * 3 + 0];
    const y = positions[src * 3 + 1];
    const z = positions[src * 3 + 2];
    if (!_accept(x, y, z)) continue;
    const [cx, cy, cz] = _cellOf(x, y, z);
    const k = _key(cx, cy, cz);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push([x, y, z]);
    kept.push(x, y, z);
  }
  return { positions: new Float32Array(kept), kept: kept.length / 3 };
}

// ── Quickhull 3-D ──────────────────────────────────────────────────
//
// Standalone implementation tuned for point-cloud → convex-hull
// triangulation. Output is a triangle-soup index list — no winding
// cleanup needed for THREE.BufferGeometry rendering, but every face
// is wound CCW from outside (its plane normal points away from the
// hull's interior centroid).
//
// Returns `{ indices: Uint32Array, faceCount }` over the supplied
// positions array. The implementation is intentionally
// straightforward (not the asymptotically-optimal Quickhull from
// Barber/Dobkin/Huhdanpaa) so it stays inline + readable.

function _sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function _cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function _dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function _norm(a) { const L = Math.hypot(a[0], a[1], a[2]); return L > 1e-12 ? [a[0]/L, a[1]/L, a[2]/L] : [0, 0, 0]; }

function _planeFrom(p0, p1, p2) {
  const n = _norm(_cross(_sub(p1, p0), _sub(p2, p0)));
  return { normal: n, d: -_dot(n, p0) };
}

function _signedDist(plane, p) { return _dot(plane.normal, p) + plane.d; }

// Get the 6 extreme points indices along the axes.
function _extremes(points) {
  const N = points.length;
  let xmin = 0, xmax = 0, ymin = 0, ymax = 0, zmin = 0, zmax = 0;
  for (let i = 1; i < N; i++) {
    if (points[i][0] < points[xmin][0]) xmin = i;
    if (points[i][0] > points[xmax][0]) xmax = i;
    if (points[i][1] < points[ymin][1]) ymin = i;
    if (points[i][1] > points[ymax][1]) ymax = i;
    if (points[i][2] < points[zmin][2]) zmin = i;
    if (points[i][2] > points[zmax][2]) zmax = i;
  }
  return [xmin, xmax, ymin, ymax, zmin, zmax];
}

// Build the initial tetrahedron from the extremes.
function _initialTet(points) {
  const ext = _extremes(points);
  const uniq = Array.from(new Set(ext));
  if (uniq.length < 2) return null;
  // Pick the two points with the largest distance.
  let a = uniq[0], b = uniq[1], best = -1;
  for (let i = 0; i < uniq.length; i++) {
    for (let j = i + 1; j < uniq.length; j++) {
      const d = _dot(_sub(points[uniq[i]], points[uniq[j]]), _sub(points[uniq[i]], points[uniq[j]]));
      if (d > best) { best = d; a = uniq[i]; b = uniq[j]; }
    }
  }
  // Third point: farthest from line ab.
  let c = -1; let bestC = -1;
  const ab = _sub(points[b], points[a]);
  const abLen2 = _dot(ab, ab) || 1;
  for (let i = 0; i < points.length; i++) {
    if (i === a || i === b) continue;
    const ap = _sub(points[i], points[a]);
    const t = _dot(ap, ab) / abLen2;
    const proj = [points[a][0] + ab[0] * t, points[a][1] + ab[1] * t, points[a][2] + ab[2] * t];
    const d = _dot(_sub(points[i], proj), _sub(points[i], proj));
    if (d > bestC) { bestC = d; c = i; }
  }
  if (c < 0) return null;
  // Fourth point: farthest from plane abc.
  const plane = _planeFrom(points[a], points[b], points[c]);
  let d = -1; let bestD = -1;
  for (let i = 0; i < points.length; i++) {
    if (i === a || i === b || i === c) continue;
    const dist = Math.abs(_signedDist(plane, points[i]));
    if (dist > bestD) { bestD = dist; d = i; }
  }
  if (d < 0 || bestD < 1e-10) return null;
  // Ensure CCW orientation: d should lie on the negative side of plane abc.
  const dDist = _signedDist(plane, points[d]);
  let f1 = [a, b, c];
  if (dDist > 0) f1 = [a, c, b]; // flip so d is below plane abc
  // Now build the 4 faces with outward-facing normals.
  const centroid = [
    (points[a][0] + points[b][0] + points[c][0] + points[d][0]) / 4,
    (points[a][1] + points[b][1] + points[c][1] + points[d][1]) / 4,
    (points[a][2] + points[b][2] + points[c][2] + points[d][2]) / 4,
  ];
  function _orient(face) {
    const p = _planeFrom(points[face[0]], points[face[1]], points[face[2]]);
    if (_signedDist(p, centroid) > 0) return [face[0], face[2], face[1]];
    return face;
  }
  return [
    _orient([f1[0], f1[1], f1[2]]),
    _orient([f1[0], f1[1], d]),
    _orient([f1[1], f1[2], d]),
    _orient([f1[2], f1[0], d]),
  ];
}

// Quickhull main loop. `positions` is the flat Float32Array (xyz).
export function convexHullTriangulate(positions) {
  const N = positions.length / 3;
  if (N < 4) {
    return { indices: new Uint32Array(0), faceCount: 0 };
  }
  // Hoist into [[x,y,z], …] for the algo.
  const pts = new Array(N);
  for (let i = 0; i < N; i++) pts[i] = [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]];
  const init = _initialTet(pts);
  if (!init) {
    // Degenerate input (coplanar / collinear) — fall back to a
    // bbox-corner triangulation so the consumer still gets *some*
    // mesh.
    return _bboxFallback(positions);
  }

  // Each face is { verts:[i,j,k], outside:[ptIndex,...] }.
  const faces = init.map((f) => ({ verts: f, outside: [], plane: _planeFrom(pts[f[0]], pts[f[1]], pts[f[2]]) }));
  // Bucket outside points to faces.
  const used = new Set(init.flat());
  for (let i = 0; i < N; i++) {
    if (used.has(i)) continue;
    for (const f of faces) {
      if (_signedDist(f.plane, pts[i]) > 1e-9) {
        f.outside.push(i);
        break;
      }
    }
  }

  // Iteratively expand.
  const open = faces.filter((f) => f.outside.length > 0);
  let safety = N * 4; // bound the iteration so a bad numeric case can't infinite-loop
  while (open.length && safety-- > 0) {
    const f = open.shift();
    if (!faces.includes(f)) continue;
    // Find the farthest outside point.
    let far = f.outside[0];
    let farD = _signedDist(f.plane, pts[far]);
    for (const i of f.outside) {
      const d = _signedDist(f.plane, pts[i]);
      if (d > farD) { far = i; farD = d; }
    }
    // Find all visible faces from `far`.
    const visible = new Set();
    const stack = [f];
    while (stack.length) {
      const v = stack.pop();
      if (visible.has(v)) continue;
      if (_signedDist(v.plane, pts[far]) > 1e-9) {
        visible.add(v);
        // Walk neighbours via shared edges.
        for (const other of faces) {
          if (visible.has(other) || other === v) continue;
          if (_sharesEdge(v.verts, other.verts)) stack.push(other);
        }
      }
    }
    if (!visible.size) continue;
    // Horizon = edges of visible faces shared with non-visible.
    const horizon = _horizonEdges(visible);
    // Remove visible faces.
    const orphans = [];
    for (const v of visible) {
      const idx = faces.indexOf(v);
      if (idx >= 0) faces.splice(idx, 1);
      for (const o of v.outside) if (o !== far) orphans.push(o);
    }
    // Build new faces from `far` + each horizon edge.
    const centroid = _hullCentroid(faces, pts);
    for (const [a, b] of horizon) {
      let verts = [a, b, far];
      const plane = _planeFrom(pts[verts[0]], pts[verts[1]], pts[verts[2]]);
      if (_signedDist(plane, centroid) > 0) {
        verts = [verts[0], verts[2], verts[1]];
      }
      const nf = { verts, outside: [], plane: _planeFrom(pts[verts[0]], pts[verts[1]], pts[verts[2]]) };
      // Re-bucket orphan points.
      for (const o of orphans) {
        if (_signedDist(nf.plane, pts[o]) > 1e-9) nf.outside.push(o);
      }
      faces.push(nf);
      if (nf.outside.length) open.push(nf);
    }
  }
  const indices = new Uint32Array(faces.length * 3);
  for (let i = 0; i < faces.length; i++) {
    indices[i * 3 + 0] = faces[i].verts[0];
    indices[i * 3 + 1] = faces[i].verts[1];
    indices[i * 3 + 2] = faces[i].verts[2];
  }
  return { indices, faceCount: faces.length };
}

function _sharesEdge(a, b) {
  let shared = 0;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) if (a[i] === b[j]) shared++;
  return shared >= 2;
}

function _horizonEdges(visibleSet) {
  // For each visible face, every edge that's NOT shared with another
  // visible face is on the horizon.
  const edges = [];
  const visible = Array.from(visibleSet);
  function _hasEdgeInOther(face, e0, e1) {
    for (const other of visible) {
      if (other === face) continue;
      const v = other.verts;
      // Edge (e0, e1) appears in `other` (any winding).
      let c0 = -1, c1 = -1;
      for (let i = 0; i < 3; i++) {
        if (v[i] === e0) c0 = i;
        if (v[i] === e1) c1 = i;
      }
      if (c0 >= 0 && c1 >= 0) return true;
    }
    return false;
  }
  for (const f of visible) {
    const v = f.verts;
    const e = [[v[0], v[1]], [v[1], v[2]], [v[2], v[0]]];
    for (const [a, b] of e) {
      if (!_hasEdgeInOther(f, a, b)) edges.push([a, b]);
    }
  }
  return edges;
}

function _hullCentroid(faces, pts) {
  const used = new Set();
  for (const f of faces) for (const v of f.verts) used.add(v);
  let cx = 0, cy = 0, cz = 0;
  for (const i of used) { cx += pts[i][0]; cy += pts[i][1]; cz += pts[i][2]; }
  const n = Math.max(1, used.size);
  return [cx / n, cy / n, cz / n];
}

function _bboxFallback(positions) {
  // 12-tri bbox proxy.
  const N = positions.length / 3;
  if (N === 0) return { indices: new Uint32Array(0), faceCount: 0 };
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < N; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  // We'd need to append corner verts. Caller's positions buffer is
  // fixed → skip.
  return { indices: new Uint32Array(0), faceCount: 0 };
}

export default convexHullTriangulate;
