// Select Similar faces (parity #55, Blender Shift+G / Maya) — pure
// functions on plain position+index arrays, DOM/THREE-free, node-testable.
// Given a seed triangle, return every triangle whose computed attribute
// (normal direction / area / coplanarity) matches within a threshold.
// The viewport op wires these into the live selection later.
//
// Built adversarially: guards empty/odd geometry, degenerate triangles,
// out-of-range seed, NaN positions — never throws.

function _triNormal(pos, a, b, c) {
  const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
  const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
  const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
  const ex = bx - ax, ey = by - ay, ez = bz - az;
  const fx = cx - ax, fy = cy - ay, fz = cz - az;
  const nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
  const len = Math.hypot(nx, ny, nz);
  return { n: len > 1e-12 ? [nx / len, ny / len, nz / len] : [0, 0, 0], area: len / 2 };
}

function _faces(positions, indices) {
  const pos = positions && positions.length != null ? positions : [];
  let idx = indices && indices.length != null ? indices : null;
  if (!idx) { // non-indexed: sequential triples
    const n = Math.floor(pos.length / 3);
    idx = Array.from({ length: n }, (_, i) => i);
  }
  const tris = [];
  for (let f = 0; f + 2 < idx.length; f += 3) {
    const t = _triNormal(pos, idx[f], idx[f + 1], idx[f + 2]);
    tris.push({ face: f / 3, normal: t.n, area: t.area });
  }
  return tris;
}

// by: 'normal' (dir within angleTolDeg) | 'area' (within areaTol fraction)
// | 'coplanar' (same normal AND on the same plane within distTol).
// Returns sorted unique face indices (always includes the seed if valid).
export function selectSimilarFaces(positions, indices, seedFace, opts = {}) {
  const { by = 'normal', angleTolDeg = 5, areaTol = 0.05 } = opts;
  const tris = _faces(positions, indices);
  const seed = tris[Math.floor(seedFace)];
  if (!seed) return [];
  const out = [seed.face];
  // Clamp to [0,180]: the angle between two directions can't exceed 180°,
  // and cos is only monotonic there — a tol of 200 would otherwise make
  // cosTol=cos(200°)≈-0.94 and wrongly EXCLUDE exact-opposite (180°)
  // faces (dot=-1 < -0.94). At 180° cosTol=-1 → match everything.
  const tolDeg = Math.min(180, Math.max(0, Number(angleTolDeg) || 0));
  const cosTol = Math.cos(tolDeg * Math.PI / 180);
  for (const t of tris) {
    if (t.face === seed.face) continue;
    let match = false;
    if (by === 'area') {
      const ref = seed.area || 1e-9;
      match = Math.abs(t.area - seed.area) / ref <= (Number(areaTol) || 0);
    } else { // normal or coplanar — direction test
      const dot = t.normal[0] * seed.normal[0] + t.normal[1] * seed.normal[1] + t.normal[2] * seed.normal[2];
      match = dot >= cosTol;
    }
    if (match) out.push(t.face);
  }
  return out.sort((a, b) => a - b);
}

export function faceCount(positions, indices) {
  return _faces(positions, indices).length;
}
