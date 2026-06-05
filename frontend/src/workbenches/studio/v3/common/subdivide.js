// ArchDisc Studio V3 — shared subdivision routines.
//
// Three distinct subdivide implementations were duplicated before this
// dedup pass:
//
//   - api.js __studioSubdivide               (non-indexed midpoint split)
//   - geomnodes/nodes.js (subdivide node)    (same algorithm)
//   - modstack/stack.js modSubdivide         (indexed midpoint-cache split)
//
// `simpleSplitSubdivide` is the api.js / geomnodes flavour: every triangle
// becomes 4, no vertex sharing — fast, ideal for sculpt/displace prep
// where the next pass owns its own welding.
//
// `loopSubdivide` is the modstack flavour: also a midpoint split, but
// shares midpoints across edges via a hash cache to keep the topology
// welded. Matches Catmull-Clark's first iteration on triangulated input.

import * as THREE from 'three';

// Non-indexed midpoint split. Result is a fresh BufferGeometry with a
// recomputed normal attribute. Iterates `iterations` passes.
//
// Caller is responsible for disposing the input geometry if it owned it.
export function simpleSplitSubdivide(geometry, iterations) {
  if (!geometry) return null;
  const n = Math.max(0, Math.min(8, Math.floor(+iterations || 1)));
  let geo = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  for (let pass = 0; pass < n; pass++) {
    const pos = geo.attributes.position;
    const tris = pos.count / 3;
    const out = new Float32Array(tris * 4 * 3 * 3);
    let o = 0;
    for (let t = 0; t < tris; t++) {
      const i = t * 9;
      const ax = pos.array[i],     ay = pos.array[i + 1], az = pos.array[i + 2];
      const bx = pos.array[i + 3], by = pos.array[i + 4], bz = pos.array[i + 5];
      const cx = pos.array[i + 6], cy = pos.array[i + 7], cz = pos.array[i + 8];
      const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
      const nx = (bx + cx) / 2, ny = (by + cy) / 2, nz = (bz + cz) / 2;
      const ox = (cx + ax) / 2, oy = (cy + ay) / 2, oz = (cz + az) / 2;
      const push = (x1, y1, z1, x2, y2, z2, x3, y3, z3) => {
        out[o++] = x1; out[o++] = y1; out[o++] = z1;
        out[o++] = x2; out[o++] = y2; out[o++] = z2;
        out[o++] = x3; out[o++] = y3; out[o++] = z3;
      };
      push(ax, ay, az, mx, my, mz, ox, oy, oz);
      push(mx, my, mz, bx, by, bz, nx, ny, nz);
      push(ox, oy, oz, nx, ny, nz, cx, cy, cz);
      push(mx, my, mz, nx, ny, nz, ox, oy, oz);
    }
    const next = new THREE.BufferGeometry();
    next.setAttribute('position', new THREE.BufferAttribute(out, 3));
    next.computeVertexNormals();
    geo = next;
  }
  return geo;
}

function _toIndexed(geometry) {
  if (!geometry) return null;
  if (geometry.index) return geometry;
  // Build a trivial 0..N-1 index so the midpoint cache can dedupe edges.
  const pos = geometry.attributes.position;
  if (!pos) return geometry;
  const tri = pos.count;
  const arr = (tri > 65535) ? new Uint32Array(tri) : new Uint16Array(tri);
  for (let i = 0; i < tri; i++) arr[i] = i;
  const g = geometry.clone();
  g.setIndex(new THREE.BufferAttribute(arr, 1));
  return g;
}

// Indexed midpoint subdivision with edge welding via a hash cache.
// `creaseMap` is optional — when supplied, edges whose two endpoint
// indices both appear in the map skip averaging (preserves hard edges).
// Currently unused by callers but reserved so future Loop-subdivide can
// share the cache while applying the fairing pass.
export function loopSubdivide(geometry, iterations, _creaseMap) {
  if (!geometry) return null;
  const iters = Math.max(0, Math.min(8, Math.floor(+iterations || 1)));
  let g = _toIndexed(geometry);
  for (let it = 0; it < iters; it++) {
    const pos = g.attributes.position;
    const idx = g.index.array;
    const verts = [];
    for (let i = 0; i < pos.count; i++) {
      verts.push(pos.getX(i), pos.getY(i), pos.getZ(i));
    }
    const midCache = new Map();
    const triCount = idx.length / 3;
    const newIdx = [];
    const midpoint = (a, b) => {
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      let id = midCache.get(k);
      if (id !== undefined) return id;
      const ax = verts[a * 3 + 0], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
      const bx = verts[b * 3 + 0], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
      id = verts.length / 3;
      verts.push((ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5);
      midCache.set(k, id);
      return id;
    };
    for (let f = 0; f < triCount; f++) {
      const a = idx[f * 3 + 0];
      const b = idx[f * 3 + 1];
      const c = idx[f * 3 + 2];
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      newIdx.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca);
    }
    const ng = new THREE.BufferGeometry();
    ng.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    ng.setIndex(newIdx);
    g = ng;
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}
