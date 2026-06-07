// ArchDisc Studio V3 — slice 892 — volumetric clouds: 3D Perlin + Worley.
//
// REAL 3-octave noise for cloud density. The Sebastian Lague / Horizon Zero
// Dawn cloud system samples cloud density from a precomputed 3D texture
// built from low-frequency PERLIN-WORLEY (large fluffy shapes) modulated by
// high-frequency WORLEY (billowy detail). This module ships pure-JS
// implementations of both — no Math.random anywhere, deterministic
// integer-lattice hashes, full gradient-based 3D Perlin (Ken Perlin 2002
// "Improving Noise") and Bridson-style Worley cellular distance.
//
// All densities are evaluated CPU-side per raymarch sample. Cheap for the
// dataUrl render target sizes the op surfaces (192×108 default → ~20k
// pixels × 64 steps × 2 noise calls ≈ 2.5M evals, all integer-lattice
// hashes + dot products, no transcendentals beyond the standard Perlin
// fade curve).

// ─── Hash helper — deterministic, NEVER Math.random ──────────────────────
function _hash3i(x, y, z, seed) {
  // Integer-lattice hash. Same construction as common/noise.js _hash3 but
  // returns a uniform [0,1) scalar; the caller picks how to interpret it.
  const s = (seed | 0) || 1;
  let h = (x * 374761393) ^ (y * 668265263) ^ (z * 1274126177) ^ (s * 0x85ebca6b);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h >>> 0) / 4294967296;
}

// ─── Perlin 3D — gradient noise (Ken Perlin 2002 "Improving Noise") ───────
//
// 12 cube-edge gradients + quintic fade + trilinear interpolation. Output
// in [-1, +1]. Compared to value noise this gives the soft directional
// streaks characteristic of cloud sheets seen from below.
const _GRAD3 = [
  [ 1, 1, 0], [-1, 1, 0], [ 1,-1, 0], [-1,-1, 0],
  [ 1, 0, 1], [-1, 0, 1], [ 1, 0,-1], [-1, 0,-1],
  [ 0, 1, 1], [ 0,-1, 1], [ 0, 1,-1], [ 0,-1,-1],
];

function _grad(xi, yi, zi, seed, dx, dy, dz) {
  // Pick a gradient from the 12-edge set via the integer-lattice hash.
  const h = _hash3i(xi, yi, zi, seed);
  const g = _GRAD3[(Math.floor(h * 4096) | 0) % 12];
  return g[0] * dx + g[1] * dy + g[2] * dz;
}

function _fade(t) {
  // Quintic fade — C2-continuous, avoids the visible cubic-fade lattice
  // artefacts of the original 1985 Perlin paper.
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function _lerp(a, b, t) { return a + (b - a) * t; }

export function perlin3D(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = _fade(xf), v = _fade(yf), w = _fade(zf);
  const s = (seed | 0) || 1;

  const n000 = _grad(xi    , yi    , zi    , s, xf    , yf    , zf    );
  const n100 = _grad(xi + 1, yi    , zi    , s, xf - 1, yf    , zf    );
  const n010 = _grad(xi    , yi + 1, zi    , s, xf    , yf - 1, zf    );
  const n110 = _grad(xi + 1, yi + 1, zi    , s, xf - 1, yf - 1, zf    );
  const n001 = _grad(xi    , yi    , zi + 1, s, xf    , yf    , zf - 1);
  const n101 = _grad(xi + 1, yi    , zi + 1, s, xf - 1, yf    , zf - 1);
  const n011 = _grad(xi    , yi + 1, zi + 1, s, xf    , yf - 1, zf - 1);
  const n111 = _grad(xi + 1, yi + 1, zi + 1, s, xf - 1, yf - 1, zf - 1);

  const x00 = _lerp(n000, n100, u);
  const x10 = _lerp(n010, n110, u);
  const x01 = _lerp(n001, n101, u);
  const x11 = _lerp(n011, n111, u);
  const y0  = _lerp(x00, x10, v);
  const y1  = _lerp(x01, x11, v);
  return _lerp(y0, y1, w);
}

// ─── Worley 3D — cellular noise (Steven Worley 1996) ──────────────────────
//
// Walks the 3×3×3 cell neighbourhood, jitters each cell centre with a
// deterministic hash, returns the F1 distance (squared, sqrt'd) to the
// nearest jittered centre. Output normalised so |worley3D| ≤ ~1.
//
// Inverted (1 - d) it produces the billowy "popcorn" cell shapes used as
// the cloud-detail erosion mask in HZD's two-texture system.
export function worley3D(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let bestD2 = 1e30;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, cy = yi + dy, cz = zi + dz;
        // Per-cell jitter — three independent hashes for the three axes.
        const jx = _hash3i(cx, cy, cz, seed);
        const jy = _hash3i(cy, cz, cx, seed + 1013);
        const jz = _hash3i(cz, cx, cy, seed + 2027);
        const px = cx + jx;
        const py = cy + jy;
        const pz = cz + jz;
        const ex = px - x, ey = py - y, ez = pz - z;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 < bestD2) bestD2 = d2;
      }
    }
  }
  // Cell corner-to-corner max distance in 3D is sqrt(3). Clamp + normalise.
  const d = Math.sqrt(bestD2);
  return Math.min(1, d / 1.41421356);
}

// ─── 3-octave FBM stack ───────────────────────────────────────────────────

export function perlinFBM3D(x, y, z, octaves, lacunarity, gain, seed) {
  const oct = Math.max(1, octaves | 0);
  const lac = lacunarity || 2;
  const g = gain == null ? 0.5 : gain;
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * perlin3D(x * freq, y * freq, z * freq, (seed | 0) + i * 911);
    norm += amp;
    amp *= g;
    freq *= lac;
  }
  return sum / Math.max(1e-6, norm); // → [-1, +1]
}

export function worleyFBM3D(x, y, z, octaves, lacunarity, gain, seed) {
  const oct = Math.max(1, octaves | 0);
  const lac = lacunarity || 2;
  const g = gain == null ? 0.5 : gain;
  let sum = 0;
  let amp = 1;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < oct; i++) {
    // 1 - worley → cell BODIES instead of cell EDGES.
    const w = 1 - worley3D(x * freq, y * freq, z * freq, (seed | 0) + i * 1597);
    sum += amp * w;
    norm += amp;
    amp *= g;
    freq *= lac;
  }
  return sum / Math.max(1e-6, norm); // → [0, 1]
}

// ─── Cloud density — the canonical Perlin-Worley combiner ────────────────
//
// Sebastian Lague's tutorial + Andrew Schneider's HZD GDC 2015 talk both
// use:  baseShape  = remap(perlin, worley→0, 1, 0, 1)
//       detailErode = worley high-freq
//       density     = saturate( baseShape * coverage - (1-coverage) - detail*0.2 )
//
// We model that pipeline here.
//
// `coverage` ∈ [0,1] — how full the sky is.
// `heightGradient` ∈ [0,1] — vertical falloff (clouds are dense in the
// middle of the layer, thin at top + bottom).
// `seed` — deterministic seed.
export function cloudDensity(x, y, z, coverage, heightGradient, seed) {
  const s = (seed | 0) || 1;

  // 3-octave low-frequency Perlin → soft sheet shapes.
  // Remap from [-1, +1] → [0, 1].
  const perl = (perlinFBM3D(x, y, z, 3, 2, 0.5, s) + 1) * 0.5;

  // 3-octave low-freq Worley (inverted) → cell BODIES.
  const worl = worleyFBM3D(x, y, z, 3, 2, 0.5, s + 7919);

  // Perlin-Worley combine: remap Perlin so worley=0 → 0 and worley=1 → 1.
  // base = remap(perl, worl, 1, 0, 1)
  // == (perl - worl) / (1 - worl)
  const base = Math.max(0, (perl - (1 - worl)) / Math.max(1e-3, worl));

  // High-frequency Worley → billowy erosion detail.
  const detail = worleyFBM3D(x * 4, y * 4, z * 4, 3, 2, 0.5, s + 1597);

  // Apply coverage + erode by detail + height-gradient falloff.
  let d = base * heightGradient * coverage - (1 - coverage) - detail * 0.2;
  if (d < 0) d = 0;
  if (d > 1) d = 1;
  return d;
}

// ─── Height-gradient curve ────────────────────────────────────────────────
//
// Clouds are densest in the middle of the layer, thinning at top + bottom.
// `h` ∈ [0,1] (0 = bottom of cloud layer, 1 = top). The Schneider curve
// uses a piecewise smoothstep — gentle ramp-up at the bottom, fast
// fall-off at the top.
export function heightGradient(h, type) {
  const t = Math.max(0, Math.min(1, h));
  if (type === 'cirrus') {
    // Thin high-altitude wisp — only the upper 30 % has any density.
    return _smoothstep(0.7, 0.85, t) * (1 - _smoothstep(0.95, 1.0, t));
  }
  if (type === 'stratus') {
    // Flat low-altitude sheet — densest in the lowest 40 %.
    return _smoothstep(0.05, 0.2, t) * (1 - _smoothstep(0.4, 0.65, t));
  }
  if (type === 'storm') {
    // Towering — extends the full layer with a slight middle peak.
    return _smoothstep(0.0, 0.1, t) * (1 - _smoothstep(0.9, 1.0, t));
  }
  // Default cumulus — wide middle, soft edges.
  return _smoothstep(0.1, 0.3, t) * (1 - _smoothstep(0.7, 0.95, t));
}

function _smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / Math.max(1e-6, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
