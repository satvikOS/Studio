// ArchDisc Studio V3 — Substance Designer noise generators (slice 775).
//
// 12 deterministic procedural noise generators. Every generator returns a
// Float32Array (size × size, scalar luminance in [0, 1]) and is seeded
// with mulberry32 from common/random.js — NO Math.random anywhere in
// this module.
//
// Generators:
//   perlin   — real Perlin gradient noise (4-corner gradient interpolation)
//   simplex  — 2D simplex-style gradient noise (skewed grid, 3-corner)
//   voronoi  — distance-to-centre cell pattern (closest of 9 neighbours)
//   worley   — closest-point distance, normalised to cell radius
//   brick    — running-bond brick pattern (every other row offset by 0.5)
//   tile     — uniform grid tiles with rounded gutters
//   wave     — sine wave on x or y axis (axis-selectable)
//   stripe   — alternating bands (square wave) along x or y
//   checker  — N × N grid of alternating cells
//   gabor    — sum of rotated Gabor kernels (filtered noise)
//   cellular — cells with uniformly-random per-cell heights
//   cracks   — random branching cracks (line-segments rasterised at width)
//
// Buffer layout: row-major, indexed `i = y * size + x`, single channel.
// All output values clamped to [0, 1]. Default size = 256.
//
// Pure JS, no new deps. Three.js conversion happens in index.js.

import { mulberry32 } from '../common/random.js';

const DEFAULT_SIZE = 256;

function _alloc(size) { return new Float32Array(size * size); }

function _clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

function _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

function _mix(a, b, t) { return a + (b - a) * t; }

// 2D gradient table for Perlin / Gabor — 8 directions on the unit circle.
function _grad2(seed) {
  const rng = mulberry32(seed);
  const g = new Float32Array(256 * 2);
  for (let i = 0; i < 256; i++) {
    const a = rng() * Math.PI * 2;
    g[i * 2] = Math.cos(a);
    g[i * 2 + 1] = Math.sin(a);
  }
  return g;
}

// Permutation table — Fisher-Yates over 0..255 with mulberry32.
function _perm(seed) {
  const rng = mulberry32(seed ^ 0x9E3779B1);
  const p = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 256; i++) p[i + 256] = p[i];
  return p;
}

// ─── 1) Perlin ────────────────────────────────────────────────────────────
// Real 2D Perlin: dot products of gradient vectors at cell corners,
// fade-interpolated. Output remapped from [-1, 1] to [0, 1].
export function perlin(params, seed) {
  const size = Math.max(8, Math.min(1024, Number(params?.size) || DEFAULT_SIZE));
  const scale = Number(params?.scale) || 8;
  const g = _grad2((seed | 0) || 1);
  const p = _perm((seed | 0) || 1);
  const buf = _alloc(size);
  function _dot(gx, gy, dx, dy) { return gx * dx + gy * dy; }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * scale;
      const v = (y / size) * scale;
      const xi = Math.floor(u) & 255;
      const yi = Math.floor(v) & 255;
      const xf = u - Math.floor(u);
      const yf = v - Math.floor(v);
      const ai = p[xi + p[yi]] & 255;
      const bi = p[xi + 1 + p[yi]] & 255;
      const ci = p[xi + p[yi + 1]] & 255;
      const di = p[xi + 1 + p[yi + 1]] & 255;
      const n00 = _dot(g[ai * 2], g[ai * 2 + 1], xf, yf);
      const n10 = _dot(g[bi * 2], g[bi * 2 + 1], xf - 1, yf);
      const n01 = _dot(g[ci * 2], g[ci * 2 + 1], xf, yf - 1);
      const n11 = _dot(g[di * 2], g[di * 2 + 1], xf - 1, yf - 1);
      const u2 = _fade(xf), v2 = _fade(yf);
      const nx0 = _mix(n00, n10, u2);
      const nx1 = _mix(n01, n11, u2);
      const n = _mix(nx0, nx1, v2);
      // Perlin lies in ~[-sqrt(2)/2, sqrt(2)/2]. Remap to [0, 1].
      buf[y * size + x] = _clamp01(n * 0.7071 + 0.5);
    }
  }
  return buf;
}

// ─── 2) Simplex ───────────────────────────────────────────────────────────
// 2D simplex-style gradient noise. Skews the input into a triangular grid
// and sums weighted gradient contributions from the three nearest corners.
export function simplex(params, seed) {
  const size = Math.max(8, Math.min(1024, Number(params?.size) || DEFAULT_SIZE));
  const scale = Number(params?.scale) || 8;
  const g = _grad2((seed | 0) || 7);
  const p = _perm((seed | 0) || 7);
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const buf = _alloc(size);
  function _contrib(gx, gy, dx, dy) {
    const t = 0.5 - dx * dx - dy * dy;
    if (t < 0) return 0;
    return (t * t) * (t * t) * (gx * dx + gy * dy);
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * scale;
      const v = (y / size) * scale;
      const s = (u + v) * F2;
      const i = Math.floor(u + s);
      const j = Math.floor(v + s);
      const t = (i + j) * G2;
      const X0 = i - t, Y0 = j - t;
      const x0 = u - X0, y0 = v - Y0;
      let i1 = 0, j1 = 0;
      if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
      const x1 = x0 - i1 + G2;
      const y1 = y0 - j1 + G2;
      const x2 = x0 - 1 + 2 * G2;
      const y2 = y0 - 1 + 2 * G2;
      const ii = i & 255;
      const jj = j & 255;
      const gi0 = p[ii + p[jj]] & 255;
      const gi1 = p[ii + i1 + p[jj + j1]] & 255;
      const gi2 = p[ii + 1 + p[jj + 1]] & 255;
      const n0 = _contrib(g[gi0 * 2], g[gi0 * 2 + 1], x0, y0);
      const n1 = _contrib(g[gi1 * 2], g[gi1 * 2 + 1], x1, y1);
      const n2 = _contrib(g[gi2 * 2], g[gi2 * 2 + 1], x2, y2);
      const n = 70 * (n0 + n1 + n2);
      buf[y * size + x] = _clamp01(n * 0.5 + 0.5);
    }
  }
  return buf;
}

// ─── 3) Voronoi (F1 distance map) ────────────────────────────────────────
// Cell pattern — distance to closest of the 9 jittered grid centres.
export function voronoi(params, seed) {
  const size = Math.max(8, Math.min(1024, Number(params?.size) || DEFAULT_SIZE));
  const cells = Math.max(2, Math.min(64, Number(params?.cells) || 8));
  const rng = mulberry32((seed | 0) || 11);
  // Pre-compute jittered cell centres for cells × cells grid.
  const jx = new Float32Array(cells * cells);
  const jy = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) {
    jx[i] = rng();
    jy[i] = rng();
  }
  const buf = _alloc(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size * cells;
      const v = y / size * cells;
      const cx = Math.floor(u);
      const cy = Math.floor(v);
      let best = 1e30;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = ((cx + ox) % cells + cells) % cells;
          const ny = ((cy + oy) % cells + cells) % cells;
          const idx = ny * cells + nx;
          const px = cx + ox + jx[idx];
          const py = cy + oy + jy[idx];
          const dx = px - u, dy = py - v;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) best = d2;
        }
      }
      const d = Math.sqrt(best);
      buf[y * size + x] = _clamp01(d);
    }
  }
  return buf;
}

// ─── 4) Worley (F1, normalised by cell radius) ───────────────────────────
// Same idea as voronoi but the output is rescaled so each cell occupies
// the full [0, 1] range — high contrast bumps useful for stone tiles.
export function worley(params, seed) {
  const size = Math.max(8, Math.min(1024, Number(params?.size) || DEFAULT_SIZE));
  const cells = Math.max(2, Math.min(64, Number(params?.cells) || 8));
  const rng = mulberry32((seed | 0) || 13);
  const jx = new Float32Array(cells * cells);
  const jy = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) {
    jx[i] = rng();
    jy[i] = rng();
  }
  // Reference radius — half the cell diagonal so values comfortably reach 1.
  const maxR = Math.SQRT1_2 * 1.1; // ≈ 0.778
  const buf = _alloc(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size * cells;
      const v = y / size * cells;
      const cx = Math.floor(u);
      const cy = Math.floor(v);
      let best = 1e30;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = ((cx + ox) % cells + cells) % cells;
          const ny = ((cy + oy) % cells + cells) % cells;
          const idx = ny * cells + nx;
          const px = cx + ox + jx[idx];
          const py = cy + oy + jy[idx];
          const dx = px - u, dy = py - v;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) best = d2;
        }
      }
      const d = Math.sqrt(best) / maxR;
      buf[y * size + x] = _clamp01(d);
    }
  }
  return buf;
}

// ─── 5) Brick (running bond) ──────────────────────────────────────────────
// Classic alternating-offset brick layout. Inside-brick value scales with
// a deterministic per-brick lightness; mortar gaps go dark.
export function brick(params, seed) {
  const size = Math.max(8, Math.min(1024, Number(params?.size) || DEFAULT_SIZE));
  const cols = Math.max(2, Math.min(32, Number(params?.cols) || 6));
  const rows = Math.max(2, Math.min(32, Number(params?.rows) || 12));
  const mortar = Math.max(0, Math.min(0.3, Number(params?.mortar) || 0.05));
  const rng = mulberry32((seed | 0) || 17);
  // Precompute per-brick lightness.
  const lights = new Float32Array(cols * rows);
  for (let i = 0; i < lights.length; i++) lights[i] = 0.55 + rng() * 0.4;
  const buf = _alloc(size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    const rowF = v * rows;
    const row = Math.floor(rowF);
    const rowFrac = rowF - row;
    const offset = (row % 2) * 0.5;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const colF = (u + offset) * cols;
      const col = ((Math.floor(colF) % cols) + cols) % cols;
      const colFrac = colF - Math.floor(colF);
      const inMortar = rowFrac < mortar || rowFrac > 1 - mortar
                    || colFrac < mortar || colFrac > 1 - mortar;
      buf[y * size + x] = inMortar ? 0.1 : lights[(row % rows) * cols + col];
    }
  }
  return buf;
}

// ─── 6) Tile (uniform grid) ───────────────────────────────────────────────
// Square tiles separated by gutters. Each tile gets a uniform deterministic
// brightness; tiles wrap on both axes.
export function tile(params, seed) {
  const size = Math.max(8, Math.min(1024, Number(params?.size) || DEFAULT_SIZE));
  const tilesX = Math.max(2, Math.min(32, Number(params?.tilesX) || 8));
  const tilesY = Math.max(2, Math.min(32, Number(params?.tilesY) || 8));
  const gutter = Math.max(0, Math.min(0.4, Number(params?.gutter) || 0.05));
  const rng = mulberry32((seed | 0) || 19);
  const tints = new Float32Array(tilesX * tilesY);
  for (let i = 0; i < tints.length; i++) tints[i] = 0.5 + rng() * 0.45;
  const buf = _alloc(size);
  for (let y = 0; y < size; y++) {
    const vy = y / size * tilesY;
    const ty = Math.floor(vy);
    const fy = vy - ty;
    for (let x = 0; x < size; x++) {
      const vx = x / size * tilesX;
      const tx = Math.floor(vx);
      const fx = vx - tx;
      const inGutter = fx < gutter || fx > 1 - gutter
                    || fy < gutter || fy > 1 - gutter;
      buf[y * size + x] = inGutter ? 0.08 : tints[(ty % tilesY) * tilesX + (tx % tilesX)];
    }
  }
  return buf;
}

// ─── 7) Wave (sine) ──────────────────────────────────────────────────────
// Sine wave on x or y. axis: 'x' (default) or 'y'.
export function wave(params, _seed) {
  const size = Math.max(8, Math.min(1024, Number(params?.size) || DEFAULT_SIZE));
  const freq = Number(params?.freq) || 4;
  const phase = Number(params?.phase) || 0;
  const axis = params?.axis === 'y' ? 'y' : 'x';
  const buf = _alloc(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (axis === 'x' ? x : y) / size;
      const v = 0.5 + 0.5 * Math.sin(t * freq * 2 * Math.PI + phase);
      buf[y * size + x] = v;
    }
  }
  return buf;
}

// ─── 8) Stripe (square wave) ──────────────────────────────────────────────
// Alternating bands on x or y. bands = total number of light + dark bands
// across the texture.
export function stripe(params, _seed) {
  const size = Math.max(8, Math.min(1024, Number(params?.size) || DEFAULT_SIZE));
  const bands = Math.max(2, Math.min(64, Number(params?.bands) || 8));
  const duty = Math.max(0.05, Math.min(0.95, Number(params?.duty) || 0.5));
  const axis = params?.axis === 'y' ? 'y' : 'x';
  const buf = _alloc(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const t = (axis === 'x' ? x : y) / size * bands;
      const f = t - Math.floor(t);
      buf[y * size + x] = f < duty ? 1 : 0;
    }
  }
  return buf;
}

// ─── 9) Checker ───────────────────────────────────────────────────────────
// N × N alternating cells.
export function checker(params, _seed) {
  const size = Math.max(8, Math.min(1024, Number(params?.size) || DEFAULT_SIZE));
  const cells = Math.max(2, Math.min(64, Number(params?.cells) || 8));
  const buf = _alloc(size);
  for (let y = 0; y < size; y++) {
    const ty = Math.floor(y / size * cells);
    for (let x = 0; x < size; x++) {
      const tx = Math.floor(x / size * cells);
      buf[y * size + x] = ((tx + ty) & 1) ? 1 : 0;
    }
  }
  return buf;
}

// ─── 10) Gabor noise ──────────────────────────────────────────────────────
// Sum of rotated Gabor kernels — each pixel evaluates a Gaussian-windowed
// cosine at every kernel within range. Kernel centres are mulberry32-
// distributed across the texture.
export function gabor(params, seed) {
  const size = Math.max(8, Math.min(1024, Number(params?.size) || DEFAULT_SIZE));
  const kernels = Math.max(8, Math.min(256, Number(params?.kernels) || 64));
  const freq = Number(params?.freq) || 0.12;
  const sigma = Number(params?.sigma) || 18;
  const rotate = Number(params?.rotate) || 0;
  const rng = mulberry32((seed | 0) || 23);
  const k = new Float32Array(kernels * 3); // x, y, angle
  for (let i = 0; i < kernels; i++) {
    k[i * 3] = rng() * size;
    k[i * 3 + 1] = rng() * size;
    k[i * 3 + 2] = rotate + (rng() - 0.5) * Math.PI;
  }
  const buf = _alloc(size);
  const reach = sigma * 3;
  const inv2s2 = 1 / (2 * sigma * sigma);
  let mn = Infinity, mx = -Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = 0;
      for (let i = 0; i < kernels; i++) {
        const kx = k[i * 3], ky = k[i * 3 + 1], ka = k[i * 3 + 2];
        const dx = x - kx, dy = y - ky;
        if (dx * dx + dy * dy > reach * reach) continue;
        const w = Math.exp(-(dx * dx + dy * dy) * inv2s2);
        const rx = Math.cos(ka) * dx + Math.sin(ka) * dy;
        acc += w * Math.cos(2 * Math.PI * freq * rx);
      }
      buf[y * size + x] = acc;
      if (acc < mn) mn = acc;
      if (acc > mx) mx = acc;
    }
  }
  // Normalise to [0, 1]. Guard against zero range.
  const span = mx - mn || 1;
  for (let i = 0; i < buf.length; i++) {
    buf[i] = (buf[i] - mn) / span;
  }
  return buf;
}

// ─── 11) Cellular (per-cell heights) ──────────────────────────────────────
// Voronoi membership but each cell gets a flat random height (no gradients).
export function cellular(params, seed) {
  const size = Math.max(8, Math.min(1024, Number(params?.size) || DEFAULT_SIZE));
  const cells = Math.max(2, Math.min(64, Number(params?.cells) || 8));
  const rng = mulberry32((seed | 0) || 29);
  const total = cells * cells;
  const jx = new Float32Array(total);
  const jy = new Float32Array(total);
  const h = new Float32Array(total);
  for (let i = 0; i < total; i++) { jx[i] = rng(); jy[i] = rng(); h[i] = rng(); }
  const buf = _alloc(size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size * cells;
      const v = y / size * cells;
      const cx = Math.floor(u);
      const cy = Math.floor(v);
      let best = 1e30;
      let bestIdx = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const nx = ((cx + ox) % cells + cells) % cells;
          const ny = ((cy + oy) % cells + cells) % cells;
          const idx = ny * cells + nx;
          const px = cx + ox + jx[idx];
          const py = cy + oy + jy[idx];
          const dx = px - u, dy = py - v;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) { best = d2; bestIdx = idx; }
        }
      }
      buf[y * size + x] = h[bestIdx];
    }
  }
  return buf;
}

// ─── 12) Cracks (random branching) ────────────────────────────────────────
// Spawn N random walks from random origins; each step segment is
// rasterised at the requested width. Branch with low probability per
// step. Dark cracks on a white ground.
export function cracks(params, seed) {
  const size = Math.max(8, Math.min(1024, Number(params?.size) || DEFAULT_SIZE));
  const numCracks = Math.max(2, Math.min(64, Number(params?.cracks) || 8));
  const steps = Math.max(8, Math.min(256, Number(params?.steps) || 32));
  const width = Math.max(0.5, Math.min(8, Number(params?.width) || 1.2));
  const branchProb = Math.max(0, Math.min(0.5, Number(params?.branchProb) || 0.06));
  const rng = mulberry32((seed | 0) || 31);
  const buf = _alloc(size);
  buf.fill(1);
  const queue = [];
  for (let i = 0; i < numCracks; i++) {
    queue.push({
      x: rng() * size,
      y: rng() * size,
      a: rng() * 2 * Math.PI,
      stepsLeft: steps,
    });
  }
  const stepLen = size / steps * 1.2;
  function _stamp(x, y) {
    const r = width;
    const x0 = Math.max(0, Math.floor(x - r));
    const x1 = Math.min(size - 1, Math.ceil(x + r));
    const y0 = Math.max(0, Math.floor(y - r));
    const y1 = Math.min(size - 1, Math.ceil(y + r));
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const dx = xx + 0.5 - x, dy = yy + 0.5 - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > r) continue;
        const v = d / r;
        const i = yy * size + xx;
        if (v < buf[i]) buf[i] = v;
      }
    }
  }
  while (queue.length) {
    const w = queue.shift();
    let { x, y, a, stepsLeft } = w;
    while (stepsLeft > 0) {
      const nx = x + Math.cos(a) * stepLen;
      const ny = y + Math.sin(a) * stepLen;
      // Rasterise a line of stamps between (x, y) and (nx, ny).
      const dx = nx - x, dy = ny - y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const sub = Math.max(2, Math.ceil(len));
      for (let s = 0; s <= sub; s++) {
        const t = s / sub;
        _stamp(x + dx * t, y + dy * t);
      }
      x = nx; y = ny;
      a += (rng() - 0.5) * 0.6; // wander
      stepsLeft--;
      if (rng() < branchProb && queue.length < 256) {
        queue.push({ x, y, a: a + (rng() - 0.5) * 1.2 + Math.PI / 2, stepsLeft: Math.max(4, Math.floor(stepsLeft / 2)) });
      }
      // Off-canvas cracks die early.
      if (x < -2 || x > size + 2 || y < -2 || y > size + 2) break;
    }
  }
  return buf;
}

// Canonical (insertion-ordered) name → fn map.
export const GENERATORS = {
  perlin, simplex, voronoi, worley,
  brick, tile, wave, stripe,
  checker, gabor, cellular, cracks,
};

export const GENERATOR_NAMES = Object.keys(GENERATORS);
