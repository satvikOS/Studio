// ArchDisc Studio V3 — Geometry-Nodes 2 / MergeByDistance (slice 757).
//
// Blender Geometry Nodes' "Merge by Distance" SOP. Welds duplicate
// vertices within `tolerance` by snapping their position to a shared
// representative, rebuilds the index so faces reference the surviving
// vertex, then strips the now-orphaned positions.
//
// We use a spatial hash keyed on `floor(coord/tolerance)` so the cost
// is O(N) instead of O(N²) — the cell size is the tolerance itself.
// A vertex matches an existing slot when both lie in the same cell AND
// the squared distance is ≤ tolerance². The check on the squared
// distance prevents two points that share a cell but sit on opposite
// edges from being merged when they're actually further apart than
// the tolerance.
//
// Returns { geometry, mergedVerts } where mergedVerts = #removed.
// The new geometry is always indexed. Non-position attributes are
// dropped (we don't know how to interpolate user attrs).

import * as THREE from 'three';

// mergeByDistance(geometry, tolerance)
//   geometry: THREE.BufferGeometry (indexed or non-indexed)
//   tolerance: number > 0
//   returns: { geometry: THREE.BufferGeometry, mergedVerts: number }
export function mergeByDistance(geometry, tolerance) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) return null;
  const tol = Number(tolerance) > 0 ? Number(tolerance) : 1e-4;
  const tolSq = tol * tol;

  // Work from indexed form; build a trivial index if we have to.
  let src = geometry;
  if (!src.index) {
    const n = src.attributes.position.count;
    const arr = n > 65535 ? new Uint32Array(n) : new Uint16Array(n);
    for (let i = 0; i < n; i++) arr[i] = i;
    src = src.clone();
    src.setIndex(new THREE.BufferAttribute(arr, 1));
  }
  const pos = src.attributes.position;
  const idx = src.index.array;
  const nVerts = pos.count;

  // Spatial hash: cellKey → list of {newIndex, x, y, z}
  const grid = new Map();
  const remap = new Int32Array(nVerts);
  const newPositions = [];
  const inv = 1 / tol;

  const cellKey = (x, y, z) =>
    `${Math.floor(x * inv)}|${Math.floor(y * inv)}|${Math.floor(z * inv)}`;

  for (let i = 0; i < nVerts; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    // Inspect this cell + the 26 neighbours so a point near a cell
    // boundary can find a match across it.
    let match = -1;
    const cx = Math.floor(x * inv), cy = Math.floor(y * inv), cz = Math.floor(z * inv);
    for (let dx = -1; dx <= 1 && match < 0; dx++) {
      for (let dy = -1; dy <= 1 && match < 0; dy++) {
        for (let dz = -1; dz <= 1 && match < 0; dz++) {
          const k = `${cx + dx}|${cy + dy}|${cz + dz}`;
          const bucket = grid.get(k);
          if (!bucket) continue;
          for (let b = 0; b < bucket.length; b++) {
            const e = bucket[b];
            const ddx = e.x - x, ddy = e.y - y, ddz = e.z - z;
            if (ddx * ddx + ddy * ddy + ddz * ddz <= tolSq) { match = e.newIndex; break; }
          }
        }
      }
    }
    if (match >= 0) {
      remap[i] = match;
    } else {
      const ni = newPositions.length / 3;
      newPositions.push(x, y, z);
      remap[i] = ni;
      const k = cellKey(x, y, z);
      let bucket = grid.get(k);
      if (!bucket) { bucket = []; grid.set(k, bucket); }
      bucket.push({ newIndex: ni, x, y, z });
    }
  }

  // Rebuild index — and drop degenerate triangles where two corners
  // collapsed to the same new vertex.
  const newIdx = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = remap[idx[t]], b = remap[idx[t + 1]], c = remap[idx[t + 2]];
    if (a === b || b === c || a === c) continue;
    newIdx.push(a, b, c);
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
  if (newPositions.length / 3 > 65535) {
    out.setIndex(new THREE.BufferAttribute(new Uint32Array(newIdx), 1));
  } else {
    out.setIndex(new THREE.BufferAttribute(new Uint16Array(newIdx), 1));
  }
  out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();

  return {
    geometry: out,
    mergedVerts: nVerts - (newPositions.length / 3),
  };
}

export default mergeByDistance;
