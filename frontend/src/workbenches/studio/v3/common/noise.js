// ArchDisc Studio V3 — shared deterministic noise primitives.
//
// Before dedup these lived in:
//   - shader/nodes.js (hash2, valueNoise 2D)
//   - shaderdeep/morenodes.js (valueNoise 2D — same formula)
//   - geomdeep/morenodes.js (valueNoise 3D — sin-based hash)
//   - modstack/stack.js (_hashNoise + _smoothNoise — interpolated lattice)
//
// The two flavours intentionally stay distinct:
//   - hash2 / valueNoise2D: sin-based hash, fast, sufficient for shader
//     graphs (low-res, post-smoothed by the texture pipeline).
//   - valueNoise3D + voronoi2D: trilinear-interpolated lattice using
//     smoothstep blends. Matches the math the modstack displace modifier
//     and geomdeep morenodes Mountain/NoiseDisplace rely on.

// ─── 2D value noise ─────────────────────────────────────────────────────
// Deterministic [0..1] hash from two floats. Sin-based — fast, no LUT.
export function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  h -= Math.floor(h);
  return h;
}

function _mix(a, b, t) { return a + (b - a) * t; }

// Smoothstep-interpolated 2D value noise → [0..1).
export function valueNoise2D(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return _mix(_mix(a, b, u), _mix(c, d, u), v);
}

// ─── 3D value noise ─────────────────────────────────────────────────────
// Returns [-1..1] for backward compatibility with geomdeep / api.js.
// Use the `*Unit` variant if you want [0..1).
export function valueNoise3D(x, y, z, _seed) {
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return (h - Math.floor(h)) * 2 - 1;
}

// Interpolated 3D value-noise (matches modstack/_smoothNoise). The seed
// argument is forwarded into a deterministic per-integer-lattice hash so
// callers can stack multiple octaves with different seeds.
export function smoothValueNoise3D(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const su = xf * xf * (3 - 2 * xf);
  const sv = yf * yf * (3 - 2 * yf);
  const sw = zf * zf * (3 - 2 * zf);
  const c000 = _hash3(xi, yi, zi, seed);
  const c100 = _hash3(xi + 1, yi, zi, seed);
  const c010 = _hash3(xi, yi + 1, zi, seed);
  const c110 = _hash3(xi + 1, yi + 1, zi, seed);
  const c001 = _hash3(xi, yi, zi + 1, seed);
  const c101 = _hash3(xi + 1, yi, zi + 1, seed);
  const c011 = _hash3(xi, yi + 1, zi + 1, seed);
  const c111 = _hash3(xi + 1, yi + 1, zi + 1, seed);
  const x00 = _mix(c000, c100, su);
  const x10 = _mix(c010, c110, su);
  const x01 = _mix(c001, c101, su);
  const x11 = _mix(c011, c111, su);
  const y0 = _mix(x00, x10, sv);
  const y1 = _mix(x01, x11, sv);
  return _mix(y0, y1, sw);
}

function _hash3(x, y, z, seed) {
  // Integer-lattice hash, same constants as modstack stack.js
  // _hashNoise. Returns [-1..1].
  const s = (seed | 0) || 1;
  let h = (x * 374761393) ^ (y * 668265263) ^ (z * 1274126177) ^ (s * 0x85ebca6b);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h % 2000) / 1000) - 1;
}

// ─── 2D Voronoi ─────────────────────────────────────────────────────────
// Returns distance to closest cell centre in a grid of `cellCount` cells
// per unit. seed shifts the random offsets so different octaves get
// independent cell distributions. Cell points jittered by hash2.
export function voronoi2D(x, y, cellCount, seed) {
  const cells = Math.max(1, cellCount | 0);
  const cx = Math.floor(x * cells);
  const cy = Math.floor(y * cells);
  let best = 1e30;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const ccx = cx + ox, ccy = cy + oy;
      const jx = hash2(ccx + (seed | 0), ccy);
      const jy = hash2(ccy, ccx + (seed | 0) + 7919);
      const px = (ccx + jx) / cells;
      const py = (ccy + jy) / cells;
      const dx = px - x, dy = py - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < best) best = d2;
    }
  }
  return Math.sqrt(best);
}
