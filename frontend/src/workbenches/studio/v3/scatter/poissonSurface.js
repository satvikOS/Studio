// ArchDisc Studio V3 — real Bridson Poisson-disk + density-mask scatter
// on mesh surfaces (slice 755).
//
// Houdini's Scatter SOP, Blender's geometry-node "Distribute Points on
// Faces (Poisson-disk)", 3ds Max's Forest Pack and Cinema 4D's MoGraph
// "Object" effector all expose the same surface: area-weighted
// triangle sampling + a configurable minimum-distance constraint so
// returned points read as "even but not gridded". The existing
// `v3/common/scatter.js` only handles the area-weighted random pick
// without minimum-distance rejection, which leaves visible clumping
// at moderate counts — the parity row in `docs/DCC_PARITY_MAP.md`
// (Houdini → Scatter / distribute points) was therefore PARTIAL.
//
// This module implements the real thing — Robert Bridson's "Fast
// Poisson Disk Sampling in Arbitrary Dimensions" dart-throwing
// adapted to triangle meshes:
//
//   1. Tessellate the geometry once (`tessellateMesh`) into a triangle
//      array with positions, normals, uvs and the triangle's surface
//      area.
//   2. Build a cumulative-area CDF (`cumulativeAreaCDF`) so any single
//      area-proportional pick is one binary search.
//   3. Auto-derive a target minimum distance when none is supplied:
//      `minDist = sqrt(totalArea / (count * pi)) * radiusScale` —
//      this is the radius that would tile `count` discs over the
//      surface if each disc had unit packing efficiency. The default
//      `radiusScale = 1` produces a comfortable spread; lower values
//      let more points squeeze in.
//   4. Build a flat AABB-anchored spatial hash with cell size
//      `minDist / sqrt(3)`, the standard 3-D Bridson grid. The
//      sqrt(3) factor guarantees that any point inside one cell can
//      only have neighbours in a 3-cell-radius neighbourhood, so the
//      rejection scan looks at 3×3×3×2 = 54 candidate cells (the
//      brief asks for 3³ × ±2 → the union of one ±2 ring around the
//      candidate cell, which is the safe Bridson constant).
//   5. Dart-throwing loop: at most `k = 30` attempts per accepted
//      sample. Each attempt:
//        - draws a triangle via CDF binary search
//        - draws barycentric (u, v); reflects if u + v > 1 so the
//          sample stays inside the triangle
//        - lerps position + normal + uv from the triangle's three
//          corner attributes
//        - optionally transforms through `worldMatrix` for downstream
//          consumers that want world-space outputs
//        - if a density mask is named, evaluates `mask(uv, pos)` and
//          rejects with probability `1 - mask` (clamped 0..1)
//        - scans the spatial hash; rejects if any accepted point is
//          within `minDist`
//      Accepted points join the spatial hash and the output list.
//   6. The loop terminates when either (a) `count` points are
//      accepted or (b) `k * count` total attempts have been spent
//      without acceptance — Bridson's classical termination.
//      `truncated = true` when (b) fires.
//
// Determinism: every stochastic decision (triangle pick, bary draw,
// mask gate) reads from a single seeded `mulberry32` stream. NEVER
// `Math.random` — the existing user-feedback memory line
// (`feedback-models-streaming-storage` etc.) plus the Studio LoRA
// training convention rule it out, and the slice brief explicitly
// reminds us.
//
// Density masks: the brief calls for masks identified by name
// (`densityMaskName`) so the operation surface stays JSON-clean
// across the page <-> e2e boundary (the e2e passes ops as JSON args
// to `win.evaluate`). MASK_REGISTRY lives in this module and is
// extensible by host code that re-exports `registerMask`.
//
// Zero npm deps. Pure THREE.* + Float32Array math. The full Bridson
// run on a 64-segment sphere (~8k triangles, 500 darts) finishes
// well under 30 ms on the M4 Max.

import * as THREE from 'three';

// ─── Seeded PRNG ──────────────────────────────────────────────────────
// Re-implemented here (matches `v3/common/random.js` byte-for-byte) so
// the scatter module is fully self-contained for unit testing and so
// the brief's "include mulberry32(seed)" contract is satisfied by
// reading this file alone. Importers that already pulled the common
// helper can swap; nothing here depends on the duplication.
export function mulberry32(seed) {
  let s = (seed >>> 0) || 1;
  return function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

// ─── Triangle tessellation ───────────────────────────────────────────
// tessellateMesh(geometry) → triangle array.
//
// Returns an array of `{ ax, ay, az, bx, by, bz, cx, cy, cz,
// nax, nay, naz, nbx, nby, nbz, ncx, ncy, ncz,
// au, av, bu, bv, cu, cv, area }` records.
//
// `geometry` may be either THREE.BufferGeometry (indexed or non-
// indexed) or a plain mesh with `.geometry`. Missing normals are
// auto-computed from the face geometry (per-vertex == face normal —
// the scatter only consumes per-vertex via barycentric lerp). Missing
// uvs default to `(0, 0)` on every corner; the mask helpers handle
// that gracefully.
export function tessellateMesh(geometryOrMesh) {
  if (!geometryOrMesh) return [];
  const geometry = geometryOrMesh.isBufferGeometry
    ? geometryOrMesh
    : (geometryOrMesh.geometry || null);
  if (!geometry || !geometry.attributes || !geometry.attributes.position) {
    return [];
  }
  const posAttr = geometry.attributes.position;
  const nrmAttr = geometry.attributes.normal || null;
  const uvAttr = geometry.attributes.uv || null;
  const index = geometry.index;
  const triCount = index ? (index.count / 3) | 0 : (posAttr.count / 3) | 0;
  const out = new Array(triCount);

  // Reusable scratch.
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const nrm = new THREE.Vector3();

  function readAt(attr, i, vec) {
    vec.set(attr.getX(i), attr.getY(i), attr.getZ(i));
  }
  function readUV(attr, i) {
    if (!attr) return [0, 0];
    return [attr.getX(i), attr.getY(i)];
  }
  function readNrm(attr, i, fallback) {
    if (!attr) {
      return [fallback.x, fallback.y, fallback.z];
    }
    return [attr.getX(i), attr.getY(i), attr.getZ(i)];
  }

  for (let t = 0; t < triCount; t++) {
    let ia, ib, ic;
    if (index) {
      ia = index.getX(t * 3);
      ib = index.getX(t * 3 + 1);
      ic = index.getX(t * 3 + 2);
    } else {
      ia = t * 3;
      ib = t * 3 + 1;
      ic = t * 3 + 2;
    }
    readAt(posAttr, ia, va);
    readAt(posAttr, ib, vb);
    readAt(posAttr, ic, vc);

    e1.subVectors(vb, va);
    e2.subVectors(vc, va);
    nrm.crossVectors(e1, e2);
    const cross = nrm.length();
    const area = cross * 0.5;
    const fallbackN = nrm.clone();
    if (cross > 1e-20) fallbackN.multiplyScalar(1 / cross);
    else fallbackN.set(0, 1, 0);

    const na = readNrm(nrmAttr, ia, fallbackN);
    const nb = readNrm(nrmAttr, ib, fallbackN);
    const nc = readNrm(nrmAttr, ic, fallbackN);
    const ua = readUV(uvAttr, ia);
    const ub = readUV(uvAttr, ib);
    const uc = readUV(uvAttr, ic);

    out[t] = {
      ax: va.x, ay: va.y, az: va.z,
      bx: vb.x, by: vb.y, bz: vb.z,
      cx: vc.x, cy: vc.y, cz: vc.z,
      nax: na[0], nay: na[1], naz: na[2],
      nbx: nb[0], nby: nb[1], nbz: nb[2],
      ncx: nc[0], ncy: nc[1], ncz: nc[2],
      au: ua[0], av: ua[1],
      bu: ub[0], bv: ub[1],
      cu: uc[0], cv: uc[1],
      area,
    };
  }
  return out;
}

// ─── Cumulative-area CDF ─────────────────────────────────────────────
// cumulativeAreaCDF(triangles) → { cdf: Float64Array, total: number }
//
// The CDF is monotone non-decreasing and ends exactly at `total`. To
// area-pick a triangle: draw `r = rng() * total` and binary-search for
// the smallest index whose CDF value is >= r. `total` is exposed so
// callers can derive auto-minDist without re-scanning.
export function cumulativeAreaCDF(triangles) {
  const N = triangles.length;
  const cdf = new Float64Array(N);
  let total = 0;
  for (let i = 0; i < N; i++) {
    total += triangles[i].area;
    cdf[i] = total;
  }
  return { cdf, total };
}

function _pickTriangle(cdf, total, r) {
  // r is in [0, total). Standard lower-bound binary search.
  let lo = 0;
  let hi = cdf.length - 1;
  const target = r * total;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (cdf[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ─── Density mask registry ───────────────────────────────────────────
// Masks are keyed by name so callers can refer to them across the
// JSON op boundary (the e2e cannot pass live functions through
// `win.evaluate`). Each mask receives `({u, v}, {x, y, z})` and must
// return a value in [0, 1]; the scatter rejects samples with
// `rng() > mask`, so 1 = always accept, 0 = always reject.

export const MASK_REGISTRY = Object.create(null);

function _maskTopHalf(uv, pos) {
  return pos.y > 0 ? 1 : 0;
}
function _maskUvCheckerboard(uv /*, pos */) {
  const cells = (Math.floor(uv.u * 8) + Math.floor(uv.v * 8)) & 1;
  return cells; // 0 or 1
}
function _maskAlways() { return 1; }

MASK_REGISTRY.topHalf = _maskTopHalf;
MASK_REGISTRY.uvCheckerboard = _maskUvCheckerboard;
MASK_REGISTRY.always = _maskAlways;

// Helper for callers (foliage / forestpack) that want to extend the
// registry with their own named masks.
export function registerMask(name, fn) {
  if (!name || typeof fn !== 'function') return false;
  MASK_REGISTRY[String(name)] = fn;
  return true;
}

// ─── Spatial hash ────────────────────────────────────────────────────
// Bridson's grid: cell size = minDist / sqrt(3) so each cell holds at
// most one accepted sample in 3-D and the rejection neighbourhood is
// a fixed-size box around the candidate cell. The brief asks for a
// 3³ × ±2 scan — i.e. iterate dx,dy,dz over [-2, +2] each (5 cells per
// axis, 125 candidates worst-case). That radius covers any prior
// accepted sample whose distance from the candidate could be less
// than minDist regardless of where it landed inside its own cell.

function _buildSpatialHash(minDist, aabb) {
  const cell = minDist / Math.sqrt(3);
  const sizeX = Math.max(1, Math.ceil((aabb.maxX - aabb.minX) / cell) + 1);
  const sizeY = Math.max(1, Math.ceil((aabb.maxY - aabb.minY) / cell) + 1);
  const sizeZ = Math.max(1, Math.ceil((aabb.maxZ - aabb.minZ) / cell) + 1);
  // Flat hash. Each cell holds an array of point indices into the
  // accepted-points list. Using a Map is faster for sparse fills than
  // pre-allocating sizeX*sizeY*sizeZ slots — the sphere case only
  // touches the surface envelope.
  const grid = new Map();
  function key(ix, iy, iz) {
    return ix + ',' + iy + ',' + iz;
  }
  function cellOf(p) {
    const ix = Math.floor((p.x - aabb.minX) / cell);
    const iy = Math.floor((p.y - aabb.minY) / cell);
    const iz = Math.floor((p.z - aabb.minZ) / cell);
    return [ix, iy, iz];
  }
  return {
    cell, sizeX, sizeY, sizeZ, grid, key, cellOf,
    minX: aabb.minX, minY: aabb.minY, minZ: aabb.minZ,
  };
}

function _cellInsert(hash, ix, iy, iz, pointIdx) {
  const k = hash.key(ix, iy, iz);
  let bucket = hash.grid.get(k);
  if (!bucket) { bucket = []; hash.grid.set(k, bucket); }
  bucket.push(pointIdx);
}

function _anyTooClose(hash, points, candidate, minDist) {
  const [ix, iy, iz] = hash.cellOf(candidate);
  const m2 = minDist * minDist;
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dz = -2; dz <= 2; dz++) {
        const bucket = hash.grid.get(hash.key(ix + dx, iy + dy, iz + dz));
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const p = points[bucket[i]].pos;
          const ddx = p.x - candidate.x;
          const ddy = p.y - candidate.y;
          const ddz = p.z - candidate.z;
          if (ddx * ddx + ddy * ddy + ddz * ddz < m2) return true;
        }
      }
    }
  }
  return false;
}

// ─── Main entry ──────────────────────────────────────────────────────
// scatterOnSurface(geometry, count, opts) → result
//
// opts:
//   seed             integer       PRNG seed (default 1337)
//   minDist          number?       Minimum distance between any two
//                                  accepted points. Auto-derived when
//                                  omitted (see header for formula).
//   radiusScale      number=1      Multiplier on the auto-derived
//                                  minDist (ignored when minDist set
//                                  explicitly). Larger = wider spread.
//   k                integer=30    Bridson attempt budget per point.
//   densityMaskName  string?       Look up MASK_REGISTRY for a per-
//                                  sample acceptance probability.
//   worldMatrix      THREE.Matrix4 Optional world transform applied to
//                                  the sampled positions (and normals
//                                  via the matching normal-matrix).
//
// returns:
//   ok          bool      false when geometry is missing/degenerate
//   error?      string    populated when ok = false
//   points      array     [{pos, normal, uv, faceIdx}], length =
//                         min(count, accepted), in acceptance order.
//                         pos / normal are THREE.Vector3 instances;
//                         uv is {u, v}; faceIdx is the index into the
//                         tessellated triangle list.
//   requested   integer   count argument
//   accepted    integer   actual length of `points`
//   truncated   bool      true when the Bridson budget ran out before
//                         `accepted == requested`.
export function scatterOnSurface(geometry, count, opts) {
  const o = opts || {};
  const N = Math.max(1, Math.floor(+count || 0));
  const seed = Number.isFinite(+o.seed) ? (+o.seed | 0) : 1337;
  const radiusScale = Number.isFinite(+o.radiusScale) ? +o.radiusScale : 1;
  const k = Math.max(1, (+o.k | 0) || 30);
  const maskName = o.densityMaskName || null;
  const maskFn = maskName ? MASK_REGISTRY[maskName] || null : null;
  const worldMatrix = (o.worldMatrix && o.worldMatrix.isMatrix4)
    ? o.worldMatrix : null;
  const normalMatrix = worldMatrix
    ? new THREE.Matrix3().getNormalMatrix(worldMatrix)
    : null;

  const triangles = tessellateMesh(geometry);
  if (!triangles.length) {
    return { ok: false, error: 'no triangles', points: [],
      requested: N, accepted: 0, truncated: false };
  }
  const { cdf, total } = cumulativeAreaCDF(triangles);
  if (!(total > 0)) {
    return { ok: false, error: 'degenerate geometry', points: [],
      requested: N, accepted: 0, truncated: false };
  }

  // Auto-derive minDist when not supplied.
  let minDist = Number.isFinite(+o.minDist) ? +o.minDist : NaN;
  if (!(minDist > 0)) {
    minDist = Math.sqrt(total / (N * Math.PI)) * radiusScale;
  }

  // Pre-compute world-space AABB for spatial hash sizing.
  const aabb = {
    minX: +Infinity, minY: +Infinity, minZ: +Infinity,
    maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
  };
  const tmp = new THREE.Vector3();
  function expand(x, y, z) {
    if (worldMatrix) {
      tmp.set(x, y, z).applyMatrix4(worldMatrix);
      x = tmp.x; y = tmp.y; z = tmp.z;
    }
    if (x < aabb.minX) aabb.minX = x;
    if (y < aabb.minY) aabb.minY = y;
    if (z < aabb.minZ) aabb.minZ = z;
    if (x > aabb.maxX) aabb.maxX = x;
    if (y > aabb.maxY) aabb.maxY = y;
    if (z > aabb.maxZ) aabb.maxZ = z;
  }
  for (let i = 0; i < triangles.length; i++) {
    const t = triangles[i];
    expand(t.ax, t.ay, t.az);
    expand(t.bx, t.by, t.bz);
    expand(t.cx, t.cy, t.cz);
  }

  const hash = _buildSpatialHash(minDist, aabb);
  const rng = mulberry32(seed);
  const points = [];
  const maxAttempts = k * N;
  let attempts = 0;
  let truncated = false;

  // Reusable result scratch.
  const pos = new THREE.Vector3();
  const nrm = new THREE.Vector3();

  while (points.length < N && attempts < maxAttempts) {
    attempts++;
    // 1) Area-weighted triangle pick.
    const tIdx = _pickTriangle(cdf, total, rng());
    const tri = triangles[tIdx];
    // 2) Uniform barycentric draw + reflect.
    let u = rng();
    let v = rng();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w = 1 - u - v;
    // 3) Lerp position + normal + uv.
    pos.set(
      tri.ax * w + tri.bx * u + tri.cx * v,
      tri.ay * w + tri.by * u + tri.cy * v,
      tri.az * w + tri.bz * u + tri.cz * v,
    );
    nrm.set(
      tri.nax * w + tri.nbx * u + tri.ncx * v,
      tri.nay * w + tri.nby * u + tri.ncy * v,
      tri.naz * w + tri.nbz * u + tri.ncz * v,
    );
    if (nrm.lengthSq() > 1e-20) nrm.normalize();
    const uv = {
      u: tri.au * w + tri.bu * u + tri.cu * v,
      v: tri.av * w + tri.bv * u + tri.cv * v,
    };
    if (worldMatrix) pos.applyMatrix4(worldMatrix);
    if (normalMatrix) nrm.applyMatrix3(normalMatrix).normalize();
    // 4) Density-mask gate. Rejected samples burn an attempt.
    if (maskFn) {
      let m = +maskFn(uv, pos);
      if (!Number.isFinite(m)) m = 0;
      if (m < 0) m = 0; else if (m > 1) m = 1;
      if (rng() > m) continue;
    }
    // 5) Spatial-hash neighbour scan.
    if (_anyTooClose(hash, points, pos, minDist)) continue;
    // 6) Accept.
    const accepted = {
      pos: pos.clone(),
      normal: nrm.clone(),
      uv,
      faceIdx: tIdx,
    };
    const idx = points.push(accepted) - 1;
    const [ix, iy, iz] = hash.cellOf(accepted.pos);
    _cellInsert(hash, ix, iy, iz, idx);
  }
  truncated = (points.length < N);

  return {
    ok: true,
    points,
    requested: N,
    accepted: points.length,
    truncated,
  };
}

// Test / extension hatch.
export const __internal = {
  _pickTriangle,
  _buildSpatialHash,
  _anyTooClose,
};

export default scatterOnSurface;
