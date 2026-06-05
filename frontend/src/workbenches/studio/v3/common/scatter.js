// ArchDisc Studio V3 — area-weighted scatter on a target mesh surface.
//
// Before dedup, near-identical scatter implementations lived in:
//   - mograph/cloner.js (clonerOnObject, vertex-distributed not face-weighted)
//   - geomtotal/nodes.js (PointsOnFaces — area-weighted)
//   - foliage/* (wave 8 — pending; the contract here matches its design)
//   - fx/emitter.js (random surface emission)
//
// Returns parallel arrays of positions + normals so callers can either
// build an InstancedMesh (mograph), spawn particles (fx), drop foliage
// (foliage), or feed a geomnodes point cloud (geomtotal).

import * as THREE from 'three';
import { mulberry32 } from './random.js';

// Build a non-indexed clone of geometry. Required because the area-
// weighting walk needs raw triangle triples.
function _ensureNonIndexed(geometry) {
  if (!geometry) return null;
  if (geometry.index) return geometry.toNonIndexed();
  return geometry;
}

// scatterOnSurface(targetMesh, count, opts?) → { ok, positions, normals }
//
// opts:
//   seed         — RNG seed (default 1)
//   includeNormals — false to skip the normal allocation (default true)
//   worldSpace   — apply targetMesh.matrixWorld to outputs (default true)
//
// positions / normals are flat Float32Array length count*3. Returns
// { ok: false } for empty geometry or degenerate input.
export function scatterOnSurface(targetMesh, count, opts) {
  if (!targetMesh || !targetMesh.geometry) return { ok: false, error: 'no mesh' };
  const N = Math.max(1, Math.floor(+count || 1));
  const o = opts || {};
  const seed = (Number(o.seed) | 0) || 1;
  const worldSpace = o.worldSpace !== false;
  const includeNormals = o.includeNormals !== false;
  const g = _ensureNonIndexed(targetMesh.geometry);
  if (!g || !g.attributes || !g.attributes.position) {
    return { ok: false, error: 'no geometry' };
  }
  const pos = g.attributes.position;
  if (pos.count < 3) return { ok: false, error: 'not enough vertices' };
  const triCount = pos.count / 3;
  if (worldSpace) targetMesh.updateMatrixWorld(true);
  // Area-weighted cumulative table.
  const areas = new Float64Array(triCount);
  const triNormals = includeNormals ? new Float32Array(triCount * 3) : null;
  let total = 0;
  const v0 = new THREE.Vector3();
  const v1 = new THREE.Vector3();
  const v2 = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  for (let t = 0; t < triCount; t++) {
    v0.fromArray(pos.array, t * 9);
    v1.fromArray(pos.array, t * 9 + 3);
    v2.fromArray(pos.array, t * 9 + 6);
    e1.subVectors(v1, v0);
    e2.subVectors(v2, v0);
    nrm.crossVectors(e1, e2);
    const a = nrm.length() * 0.5;
    total += a;
    areas[t] = total;
    if (includeNormals) {
      if (a > 0) nrm.multiplyScalar(1 / (2 * a));
      triNormals[t * 3]     = nrm.x;
      triNormals[t * 3 + 1] = nrm.y;
      triNormals[t * 3 + 2] = nrm.z;
    }
  }
  if (total <= 0) return { ok: false, error: 'degenerate geometry' };

  const rng = mulberry32(seed);
  const positions = new Float32Array(N * 3);
  const normals = includeNormals ? new Float32Array(N * 3) : null;
  const wm = worldSpace ? targetMesh.matrixWorld : null;
  const nm = (worldSpace && includeNormals)
    ? new THREE.Matrix3().getNormalMatrix(targetMesh.matrixWorld)
    : null;
  const ptmp = new THREE.Vector3();
  const ntmp = new THREE.Vector3();
  for (let s = 0; s < N; s++) {
    const r = rng() * total;
    let lo = 0, hi = triCount - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (areas[mid] < r) lo = mid + 1; else hi = mid;
    }
    const t = lo;
    let u = rng(), w = rng();
    if (u + w > 1) { u = 1 - u; w = 1 - w; }
    const vv = 1 - u - w;
    v0.fromArray(pos.array, t * 9);
    v1.fromArray(pos.array, t * 9 + 3);
    v2.fromArray(pos.array, t * 9 + 6);
    ptmp.set(
      v0.x * vv + v1.x * u + v2.x * w,
      v0.y * vv + v1.y * u + v2.y * w,
      v0.z * vv + v1.z * u + v2.z * w,
    );
    if (wm) ptmp.applyMatrix4(wm);
    positions[s * 3]     = ptmp.x;
    positions[s * 3 + 1] = ptmp.y;
    positions[s * 3 + 2] = ptmp.z;
    if (includeNormals) {
      ntmp.set(triNormals[t * 3], triNormals[t * 3 + 1], triNormals[t * 3 + 2]);
      if (nm) { ntmp.applyMatrix3(nm); ntmp.normalize(); }
      normals[s * 3]     = ntmp.x;
      normals[s * 3 + 1] = ntmp.y;
      normals[s * 3 + 2] = ntmp.z;
    }
  }
  return { ok: true, count: N, positions, normals };
}
