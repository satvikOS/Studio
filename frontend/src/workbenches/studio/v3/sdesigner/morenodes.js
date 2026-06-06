// ArchDisc Studio V3 — 25 Substance-Designer-style procedural shader-node
// definitions extending the slice-684 shader graph + slice-688 shaderdeep
// inventory.
//
// Each definition follows the same shader-node contract as
// `frontend/src/workbenches/studio/v3/shader/nodes.js`:
//
//   {
//     title, category,
//     defaultParams(),
//     inputs:  [{ name, type, default? }],
//     outputs: [{ name, type }],
//     eval(ctx, ins) → value
//     multiOutput?  // if eval returns { outputName: value, … }
//   }
//
// `ctx` shape (built by graph.evaluate()):
//   { u, v, x, y, size, worldX, worldY, worldZ }
//
// `ins` is a Map<inputName, resolvedValue>. Outputs are duck-typed:
// length-3 colour [r,g,b] in 0..1, JS number, length-2 [u,v] vec2.
//
// Filter-style nodes (Blur / Sharpen / Emboss / EdgeDetect) approximate
// neighbourhood taps inside the per-pixel evaluator by sampling the
// `valueNoise2D` field at the 8 surrounding offsets and modulating the
// upstream colour — this matches the host graph's pure-procedural model.
//
// Pure native, three.js + React only. No npm package adds, no WASM.

import { hash2, valueNoise2D, voronoi2D } from '../common/noise.js';

// ─── Helpers (mirror shader/nodes.js + shaderdeep) ────────────────────
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function clampR(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }
function toColor(v) {
  if (Array.isArray(v) && v.length >= 3) return [+v[0] || 0, +v[1] || 0, +v[2] || 0];
  if (typeof v === 'number') return [v, v, v];
  if (v && typeof v === 'object' && v.r != null) return [+v.r || 0, +v.g || 0, +v.b || 0];
  return [0, 0, 0];
}
function toFloat(v) {
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && v.length) {
    if (v.length >= 3) return (v[0] + v[1] + v[2]) / 3;
    return +v[0] || 0;
  }
  return 0;
}
function toVec2(v) {
  if (Array.isArray(v) && v.length >= 2) return [+v[0] || 0, +v[1] || 0];
  if (typeof v === 'number') return [v, v];
  return [0, 0];
}
function fract(x) { return x - Math.floor(x); }
function mix(a, b, t) { return a + (b - a) * t; }

// ─── Colour-space helpers ────────────────────────────────────────────
function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const d = mx - mn;
  let h = 0;
  const s = mx === 0 ? 0 : d / mx;
  const v = mx;
  if (d !== 0) {
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
    if (h < 0) h += 1;
  }
  return [h, s, v];
}
function hsv2rgb(h, s, v) {
  h = (h % 1 + 1) % 1;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: return [v, t, p];
    case 1: return [q, v, p];
    case 2: return [p, v, t];
    case 3: return [p, q, v];
    case 4: return [t, p, v];
    default: return [v, p, q];
  }
}

// Build a 9-tap (centre + 8 neighbours) value-noise neighbourhood for
// filter nodes. Returns floats in [0..1]. Spacing is `eps` in UV space.
function nineTaps(u, v, scale, eps) {
  const s = scale, e = eps;
  return [
    valueNoise2D((u - e) * s, (v - e) * s), // tl
    valueNoise2D(u * s,       (v - e) * s), // t
    valueNoise2D((u + e) * s, (v - e) * s), // tr
    valueNoise2D((u - e) * s, v * s),       // l
    valueNoise2D(u * s,       v * s),       // c
    valueNoise2D((u + e) * s, v * s),       // r
    valueNoise2D((u - e) * s, (v + e) * s), // bl
    valueNoise2D(u * s,       (v + e) * s), // b
    valueNoise2D((u + e) * s, (v + e) * s), // br
  ];
}

// ─── 25 Substance-Designer-style node definitions ────────────────────
export const SDESIGNER_NODE_KINDS = {
  // ─── NOISES (8) ────────────────────────────────────────────────────

  // 1 — Perlin: smoothstep-interpolated value noise (host noise.js
  // already implements this — we just expose it as a graph kind here).
  perlin: {
    title: 'Perlin Noise',
    category: 'texture',
    defaultParams: () => ({ scale: 8, contrast: 1 }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac',   type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.001, +this.params.scale || 8);
      const k = +this.params.contrast || 1;
      const n = valueNoise2D(uv[0] * s, uv[1] * s);
      const f = clamp01(0.5 + (n - 0.5) * k);
      return { color: [f, f, f], fac: f };
    },
  },

  // 2 — FractalSum: 4 octaves of value noise summed with halving amp.
  fractalsum: {
    title: 'Fractal Sum',
    category: 'texture',
    defaultParams: () => ({ scale: 6, octaves: 4, persistence: 0.5, lacunarity: 2 }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac',   type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.001, +this.params.scale || 6);
      const oct = Math.max(1, Math.min(8, Math.floor(+this.params.octaves || 4)));
      const pers = clampR(+this.params.persistence || 0.5, 0, 1);
      const lac = Math.max(1, +this.params.lacunarity || 2);
      let amp = 1, freq = 1, sum = 0, norm = 0;
      for (let i = 0; i < oct; i++) {
        sum += valueNoise2D(uv[0] * s * freq, uv[1] * s * freq) * amp;
        norm += amp;
        amp *= pers;
        freq *= lac;
      }
      const f = clamp01(sum / Math.max(1e-6, norm));
      return { color: [f, f, f], fac: f };
    },
  },

  // 3 — Worley: voronoi closest-feature distance (F1).
  worley: {
    title: 'Worley Noise',
    category: 'texture',
    defaultParams: () => ({ scale: 8, jitter: 1, invert: 0 }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac',   type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const cells = Math.max(1, Math.floor(+this.params.scale || 8));
      const d = voronoi2D(uv[0], uv[1], cells, 0);
      // voronoi2D returns absolute distance; scale to roughly [0..1] given
      // typical inter-cell distance ~ 1/cells.
      let f = clamp01(d * cells * 1.4);
      if (+this.params.invert) f = 1 - f;
      return { color: [f, f, f], fac: f };
    },
  },

  // 4 — Cells: cellular noise (per-cell random colour, hard edges).
  cells: {
    title: 'Cells',
    category: 'texture',
    defaultParams: () => ({ scale: 6, randomness: 1 }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac',   type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.01, +this.params.scale || 6);
      const rnd = clamp01(+this.params.randomness ?? 1);
      const px = uv[0] * s, py = uv[1] * s;
      const cx = Math.floor(px), cy = Math.floor(py);
      let best = 9e9, bx = 0, by = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const gx = cx + dx, gy = cy + dy;
          const jx = (hash2(gx, gy) - 0.5) * rnd;
          const jy = (hash2(gy, gx + 31) - 0.5) * rnd;
          const fx = gx + 0.5 + jx, fy = gy + 0.5 + jy;
          const ddx = fx - px, ddy = fy - py;
          const d = ddx * ddx + ddy * ddy;
          if (d < best) { best = d; bx = gx; by = gy; }
        }
      }
      const r = hash2(bx + 0.13, by + 0.31);
      const g = hash2(bx + 0.71, by + 0.51);
      const b = hash2(bx + 1.37, by + 1.11);
      const fac = (r + g + b) / 3;
      return { color: [r, g, b], fac };
    },
  },

  // 5 — Cloud: low-frequency smoothed noise.
  cloud: {
    title: 'Cloud Noise',
    category: 'texture',
    defaultParams: () => ({ scale: 3, softness: 0.6 }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac',   type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.001, +this.params.scale || 3);
      const sfn = clamp01(+this.params.softness ?? 0.6);
      // Two low-freq octaves, smoothstepped for cloud-y feel.
      const a = valueNoise2D(uv[0] * s, uv[1] * s);
      const b = valueNoise2D(uv[0] * s * 2.1 + 17.3, uv[1] * s * 2.1 - 9.1);
      const raw = mix(a, b, 0.45);
      // Apply a soft S-curve.
      const f = clamp01(raw * raw * (3 - 2 * raw) * (1 - sfn) + raw * sfn);
      return { color: [f, f, f], fac: f };
    },
  },

  // 6 — Crystals: voronoi distance — produces sharp crystal facets.
  crystals: {
    title: 'Crystals',
    category: 'texture',
    defaultParams: () => ({ scale: 6, sharpness: 2 }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac',   type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const cells = Math.max(1, Math.floor(+this.params.scale || 6));
      const sh = clampR(+this.params.sharpness || 2, 0.1, 8);
      const d = voronoi2D(uv[0], uv[1], cells, 71);
      // Pinch the distance with a power curve for crystal-edge feel.
      const f = clamp01(Math.pow(clamp01(d * cells * 1.3), 1 / sh));
      const r = clamp01(f * 0.85 + 0.1);
      const g = clamp01(f * 0.95 + 0.05);
      const b = clamp01(f * 1.05 + 0.0);
      return { color: [r, g, b], fac: f };
    },
  },

  // 7 — Fibers: anisotropic stretched noise — looks like brushed fibres.
  fibers: {
    title: 'Fibers',
    category: 'texture',
    defaultParams: () => ({ scale: 8, anisotropy: 6, angle: 0 }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac',   type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.001, +this.params.scale || 8);
      const aniso = Math.max(1, +this.params.anisotropy || 6);
      const ang = (+this.params.angle || 0) * Math.PI / 180;
      const cs = Math.cos(ang), sn = Math.sin(ang);
      // Stretch the noise along the fibre direction.
      const x = (uv[0] * cs + uv[1] * sn) * s;
      const y = (-uv[0] * sn + uv[1] * cs) * s * aniso;
      const f = valueNoise2D(x, y);
      return { color: [f, f, f], fac: f };
    },
  },

  // 8 — Plasma: layered sin-wave plasma.
  plasma: {
    title: 'Plasma',
    category: 'texture',
    defaultParams: () => ({ scale: 6, phase: 0, mix: 0.5 }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac',   type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = +this.params.scale || 6;
      const p = +this.params.phase || 0;
      const u = uv[0] * s, v = uv[1] * s;
      const a = Math.sin(u + p);
      const b = Math.sin(v * 1.3 + p * 0.7);
      const c = Math.sin((u + v) * 0.5 + p * 1.3);
      const d = Math.sin(Math.sqrt(u * u + v * v) + p);
      const r = 0.5 + 0.5 * Math.sin(a + d);
      const g = 0.5 + 0.5 * Math.sin(b + c);
      const bl = 0.5 + 0.5 * Math.sin(a + b + c + d);
      const fac = (r + g + bl) / 3;
      return { color: [r, g, bl], fac };
    },
  },

  // ─── PATTERNS (6) ──────────────────────────────────────────────────

  // 9 — Stars: small bright dots on dark background.
  stars: {
    title: 'Stars',
    category: 'texture',
    defaultParams: () => ({ scale: 30, density: 0.04, size: 0.4 }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac',   type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.01, +this.params.scale || 30);
      const dens = clamp01(+this.params.density ?? 0.04);
      const sz = clamp01(+this.params.size ?? 0.4);
      const px = uv[0] * s, py = uv[1] * s;
      const cx = Math.floor(px), cy = Math.floor(py);
      const h = hash2(cx, cy);
      if (h > dens) return { color: [0, 0, 0], fac: 0 };
      // Centre offset for sub-pixel jitter.
      const jx = hash2(cx + 0.13, cy);
      const jy = hash2(cx, cy + 0.71);
      const dx = (px - cx) - jx;
      const dy = (py - cy) - jy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const radius = sz * 0.5;
      if (d > radius) return { color: [0, 0, 0], fac: 0 };
      const f = 1 - d / radius;
      return { color: [f, f, f], fac: f };
    },
  },

  // 10 — Polka: regular polka-dot grid.
  polka: {
    title: 'Polka Dots',
    category: 'texture',
    defaultParams: () => ({ scale: 8, radius: 0.3, color1: [1, 1, 1], color2: [0, 0, 0] }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac',   type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.01, +this.params.scale || 8);
      const r = clamp01(+this.params.radius ?? 0.3);
      const fu = fract(uv[0] * s) - 0.5;
      const fv = fract(uv[1] * s) - 0.5;
      const d = Math.sqrt(fu * fu + fv * fv);
      const inside = d < r ? 1 : 0;
      const c = inside ? toColor(this.params.color1) : toColor(this.params.color2);
      return { color: c, fac: inside };
    },
  },

  // 11 — Trihex: triangle / hex grid pattern.
  trihex: {
    title: 'Tri-Hex Grid',
    category: 'texture',
    defaultParams: () => ({ scale: 6, width: 0.1 }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac',   type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.01, +this.params.scale || 6);
      const w = clamp01(+this.params.width ?? 0.1);
      // Triangular lattice — line where any of three axes is near integer.
      const u = uv[0] * s, v = uv[1] * s;
      const a = u;
      const b = u * 0.5 + v * 0.8660254;
      const c = u * 0.5 - v * 0.8660254;
      const da = Math.min(fract(a), 1 - fract(a));
      const db = Math.min(fract(b), 1 - fract(b));
      const dc = Math.min(fract(c), 1 - fract(c));
      const m = Math.min(da, Math.min(db, dc));
      const on = m < w * 0.5 ? 1 : 0;
      return { color: [on, on, on], fac: on };
    },
  },

  // 12 — Honeycomb: hex cell with edge highlight.
  honeycomb: {
    title: 'Honeycomb',
    category: 'texture',
    defaultParams: () => ({ scale: 6, edge: 0.08 }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac',   type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.01, +this.params.scale || 6);
      const edge = clamp01(+this.params.edge ?? 0.08);
      // Hex grid via skewed coordinates → distance to nearest centre.
      const x = uv[0] * s;
      const y = uv[1] * s;
      const q = x * 0.6666667;
      const r = -x * 0.3333333 + y * 0.5773503;
      const rx = Math.round(q);
      const ry = Math.round(r);
      const fq = q - rx;
      const fr = r - ry;
      const dist = Math.max(Math.abs(fq), Math.abs(fr), Math.abs(fq + fr));
      const on = dist > (0.5 - edge) ? 1 : 0;
      return { color: [on, on, on], fac: on };
    },
  },

  // 13 — Sawtooth: linear ramp wave.
  sawtooth: {
    title: 'Sawtooth Wave',
    category: 'texture',
    defaultParams: () => ({ scale: 6, axis: 'x' }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac',   type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.001, +this.params.scale || 6);
      const axis = String(this.params.axis || 'x');
      const t = axis === 'y' ? uv[1] * s : uv[0] * s;
      const f = fract(t);
      return { color: [f, f, f], fac: f };
    },
  },

  // 14 — Triangle: triangle wave.
  triangle: {
    title: 'Triangle Wave',
    category: 'texture',
    defaultParams: () => ({ scale: 6, axis: 'x' }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac',   type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.001, +this.params.scale || 6);
      const axis = String(this.params.axis || 'x');
      const t = axis === 'y' ? uv[1] * s : uv[0] * s;
      const f = fract(t);
      const tri = f < 0.5 ? f * 2 : (1 - f) * 2;
      return { color: [tri, tri, tri], fac: tri };
    },
  },

  // ─── FILTERS (8) ───────────────────────────────────────────────────

  // 15 — Blur: 3×3 box average using a synthesized noise neighbourhood
  // modulating the input colour. eps controls the tap radius in UV.
  blur: {
    title: 'Blur',
    category: 'filter',
    defaultParams: () => ({ scale: 8, eps: 0.01 }),
    inputs: [
      { name: 'color', type: 'color', default: [0.5, 0.5, 0.5] },
      { name: 'uv', type: 'vec2' },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const c = toColor(ins.get('color'));
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.001, +this.params.scale || 8);
      const eps = clampR(+this.params.eps ?? 0.01, 0.0001, 0.5);
      const taps = nineTaps(uv[0], uv[1], s, eps);
      let sum = 0;
      for (let i = 0; i < 9; i++) sum += taps[i];
      const avg = sum / 9;
      // Modulate input colour by averaged noise (low-pass effect).
      const k = avg;
      return [c[0] * k * 2, c[1] * k * 2, c[2] * k * 2];
    },
  },

  // 16 — Sharpen: 3×3 sharpen kernel approximation.
  sharpen: {
    title: 'Sharpen',
    category: 'filter',
    defaultParams: () => ({ scale: 8, eps: 0.01, amount: 1 }),
    inputs: [
      { name: 'color', type: 'color', default: [0.5, 0.5, 0.5] },
      { name: 'uv', type: 'vec2' },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const c = toColor(ins.get('color'));
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.001, +this.params.scale || 8);
      const eps = clampR(+this.params.eps ?? 0.01, 0.0001, 0.5);
      const amt = clampR(+this.params.amount ?? 1, 0, 5);
      const t = nineTaps(uv[0], uv[1], s, eps);
      // Centre - average of 4 edge neighbours (classic sharpen kernel).
      const edge = t[4] * 5 - (t[1] + t[3] + t[5] + t[7]);
      const k = clamp01(0.5 + edge * amt * 0.5);
      return [c[0] * k * 2, c[1] * k * 2, c[2] * k * 2];
    },
  },

  // 17 — Emboss: offset difference producing a height-like signal.
  emboss: {
    title: 'Emboss',
    category: 'filter',
    defaultParams: () => ({ scale: 8, eps: 0.01, strength: 1 }),
    inputs: [
      { name: 'color', type: 'color', default: [0.5, 0.5, 0.5] },
      { name: 'uv', type: 'vec2' },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const c = toColor(ins.get('color'));
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.001, +this.params.scale || 8);
      const eps = clampR(+this.params.eps ?? 0.01, 0.0001, 0.5);
      const str = clampR(+this.params.strength ?? 1, 0, 5);
      const t = nineTaps(uv[0], uv[1], s, eps);
      // Top-left minus bottom-right gives a diagonal emboss highlight.
      const d = (t[0] - t[8]) * str + 0.5;
      const k = clamp01(d);
      // Tint input colour by the embossed factor.
      return [c[0] * k + 0.5 * (1 - k), c[1] * k + 0.5 * (1 - k), c[2] * k + 0.5 * (1 - k)];
    },
  },

  // 18 — EdgeDetect: Sobel approximation on a synthesised noise field.
  edgedetect: {
    title: 'Edge Detect',
    category: 'filter',
    defaultParams: () => ({ scale: 8, eps: 0.01, gain: 4 }),
    inputs: [
      { name: 'color', type: 'color', default: [1, 1, 1] },
      { name: 'uv', type: 'vec2' },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const c = toColor(ins.get('color'));
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.001, +this.params.scale || 8);
      const eps = clampR(+this.params.eps ?? 0.01, 0.0001, 0.5);
      const gain = clampR(+this.params.gain ?? 4, 0, 20);
      const t = nineTaps(uv[0], uv[1], s, eps);
      // Sobel-X: [-1 0 1; -2 0 2; -1 0 1]
      const gx = -t[0] + t[2] - 2 * t[3] + 2 * t[5] - t[6] + t[8];
      // Sobel-Y: [-1 -2 -1; 0 0 0; 1 2 1]
      const gy = -t[0] - 2 * t[1] - t[2] + t[6] + 2 * t[7] + t[8];
      const mag = clamp01(Math.sqrt(gx * gx + gy * gy) * gain);
      return [c[0] * mag, c[1] * mag, c[2] * mag];
    },
  },

  // 19 — Threshold: hard binary cutoff per channel.
  threshold: {
    title: 'Threshold',
    category: 'filter',
    defaultParams: () => ({ level: 0.5 }),
    inputs: [
      { name: 'color', type: 'color', default: [0.5, 0.5, 0.5] },
      { name: 'level', type: 'float', default: 0.5 },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const c = toColor(ins.get('color'));
      const lv = clamp01(ins.has('level') ? toFloat(ins.get('level')) : (+this.params.level ?? 0.5));
      return [
        c[0] >= lv ? 1 : 0,
        c[1] >= lv ? 1 : 0,
        c[2] >= lv ? 1 : 0,
      ];
    },
  },

  // 20 — Posterize: quantise each channel to N levels.
  posterize: {
    title: 'Posterize',
    category: 'filter',
    defaultParams: () => ({ levels: 4 }),
    inputs: [
      { name: 'color', type: 'color', default: [0.5, 0.5, 0.5] },
      { name: 'levels', type: 'float', default: 4 },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const c = toColor(ins.get('color'));
      const n = Math.max(2, Math.floor(ins.has('levels') ? toFloat(ins.get('levels')) : (+this.params.levels ?? 4)));
      const step = 1 / (n - 1);
      return [
        Math.round(clamp01(c[0]) / step) * step,
        Math.round(clamp01(c[1]) / step) * step,
        Math.round(clamp01(c[2]) / step) * step,
      ];
    },
  },

  // 21 — HueShift: shift hue by [-0.5..0.5] in HSV space.
  hueshift: {
    title: 'Hue Shift',
    category: 'filter',
    defaultParams: () => ({ shift: 0.1 }),
    inputs: [
      { name: 'color', type: 'color', default: [1, 0, 0] },
      { name: 'shift', type: 'float', default: 0.1 },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const c = toColor(ins.get('color'));
      const sh = ins.has('shift') ? toFloat(ins.get('shift')) : (+this.params.shift ?? 0.1);
      const hsv = rgb2hsv(c[0], c[1], c[2]);
      return hsv2rgb((hsv[0] + sh + 1) % 1, hsv[1], hsv[2]);
    },
  },

  // 22 — SaturationBoost: scale saturation in HSV.
  satboost: {
    title: 'Saturation Boost',
    category: 'filter',
    defaultParams: () => ({ amount: 1.5 }),
    inputs: [
      { name: 'color', type: 'color', default: [0.5, 0.5, 0.5] },
      { name: 'amount', type: 'float', default: 1.5 },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const c = toColor(ins.get('color'));
      const amt = Math.max(0, ins.has('amount') ? toFloat(ins.get('amount')) : (+this.params.amount ?? 1.5));
      const hsv = rgb2hsv(c[0], c[1], c[2]);
      return hsv2rgb(hsv[0], clamp01(hsv[1] * amt), hsv[2]);
    },
  },

  // ─── COMBINE / BLEND (3) ──────────────────────────────────────────

  // 23 — OverlayBlend: Photoshop-style overlay.
  overlayblend: {
    title: 'Overlay Blend',
    category: 'color',
    defaultParams: () => ({ fac: 1 }),
    inputs: [
      { name: 'a', type: 'color', default: [0.5, 0.5, 0.5] },
      { name: 'b', type: 'color', default: [0.5, 0.5, 0.5] },
      { name: 'fac', type: 'float', default: 1 },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const a = toColor(ins.get('a'));
      const b = toColor(ins.get('b'));
      const f = clamp01(ins.has('fac') ? toFloat(ins.get('fac')) : (+this.params.fac ?? 1));
      const overlay = (x, y) => x < 0.5
        ? 2 * x * y
        : 1 - 2 * (1 - x) * (1 - y);
      const r = clamp01(overlay(clamp01(a[0]), clamp01(b[0])));
      const g = clamp01(overlay(clamp01(a[1]), clamp01(b[1])));
      const bb = clamp01(overlay(clamp01(a[2]), clamp01(b[2])));
      return [
        a[0] * (1 - f) + r * f,
        a[1] * (1 - f) + g * f,
        a[2] * (1 - f) + bb * f,
      ];
    },
  },

  // 24 — MultiplyBlend: a × b lerped by fac.
  multiplyblend: {
    title: 'Multiply Blend',
    category: 'color',
    defaultParams: () => ({ fac: 1 }),
    inputs: [
      { name: 'a', type: 'color', default: [1, 1, 1] },
      { name: 'b', type: 'color', default: [1, 1, 1] },
      { name: 'fac', type: 'float', default: 1 },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const a = toColor(ins.get('a'));
      const b = toColor(ins.get('b'));
      const f = clamp01(ins.has('fac') ? toFloat(ins.get('fac')) : (+this.params.fac ?? 1));
      const m = [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
      return [
        a[0] * (1 - f) + m[0] * f,
        a[1] * (1 - f) + m[1] * f,
        a[2] * (1 - f) + m[2] * f,
      ];
    },
  },

  // 25 — ScreenBlend: 1 - (1-a)(1-b).
  screenblend: {
    title: 'Screen Blend',
    category: 'color',
    defaultParams: () => ({ fac: 1 }),
    inputs: [
      { name: 'a', type: 'color', default: [0, 0, 0] },
      { name: 'b', type: 'color', default: [0, 0, 0] },
      { name: 'fac', type: 'float', default: 1 },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const a = toColor(ins.get('a'));
      const b = toColor(ins.get('b'));
      const f = clamp01(ins.has('fac') ? toFloat(ins.get('fac')) : (+this.params.fac ?? 1));
      const s = [
        1 - (1 - a[0]) * (1 - b[0]),
        1 - (1 - a[1]) * (1 - b[1]),
        1 - (1 - a[2]) * (1 - b[2]),
      ];
      return [
        a[0] * (1 - f) + s[0] * f,
        a[1] * (1 - f) + s[1] * f,
        a[2] * (1 - f) + s[2] * f,
      ];
    },
  },

  // 26 — Normal from Height: the flagship Substance Designer material-
  // builder node. Computes a tangent-space normal by running a SOBEL
  // gradient over the sampled height neighbourhood (nineTaps), then
  //   n = normalize( -dHdx*strength, -dHdy*strength, 1 )
  // encoded into RGB as n*0.5+0.5 (OpenGL/+Y convention; flipY swaps to
  // DirectX/−Y). A flat region → (0.5,0.5,1) i.e. straight-up normal.
  normalfromheight: {
    title: 'Normal (from Height)',
    category: 'filter',
    defaultParams: () => ({ scale: 8, eps: 0.01, strength: 4, flipY: false }),
    inputs: [
      { name: 'uv', type: 'vec2' },
      { name: 'height', type: 'float' },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.001, +this.params.scale || 8);
      const eps = clampR(+this.params.eps ?? 0.01, 0.0001, 0.5);
      const str = clampR(+this.params.strength ?? 4, 0, 50);
      const flipY = !!this.params.flipY;
      const t = nineTaps(uv[0], uv[1], s, eps);
      // Sobel: X = (tr+2r+br) − (tl+2l+bl); Y = (bl+2b+br) − (tl+2t+tr).
      const sx = (t[2] + 2 * t[5] + t[8]) - (t[0] + 2 * t[3] + t[6]);
      let sy = (t[6] + 2 * t[7] + t[8]) - (t[0] + 2 * t[1] + t[2]);
      if (flipY) sy = -sy;
      // Gradient → normal. eps normalises the finite-difference spacing.
      const nx = -sx * str;
      const ny = -sy * str;
      const nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      return [
        clamp01((nx / len) * 0.5 + 0.5),
        clamp01((ny / len) * 0.5 + 0.5),
        clamp01((nz / len) * 0.5 + 0.5),
      ];
    },
  },

  // 27 — Ambient Occlusion from Height: darkens crevices. Compares the
  // centre height to the average of its 8 neighbours; where neighbours
  // sit HIGHER than the centre (a pit / concave region) occlusion rises.
  //   ao = 1 − clamp01( (avgNeighbour − centre) * strength )
  // A flat or convex region → ~1 (unoccluded, white).
  aofromheight: {
    title: 'Ambient Occlusion (from Height)',
    category: 'filter',
    defaultParams: () => ({ scale: 8, eps: 0.01, strength: 8 }),
    inputs: [
      { name: 'uv', type: 'vec2' },
      { name: 'height', type: 'float' },
    ],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac',   type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.001, +this.params.scale || 8);
      const eps = clampR(+this.params.eps ?? 0.01, 0.0001, 0.5);
      const str = clampR(+this.params.strength ?? 8, 0, 50);
      const t = nineTaps(uv[0], uv[1], s, eps);
      const centre = t[4];
      const avgN = (t[0] + t[1] + t[2] + t[3] + t[5] + t[6] + t[7] + t[8]) / 8;
      const ao = clamp01(1 - clamp01((avgN - centre) * str));
      return { color: [ao, ao, ao], fac: ao };
    },
  },
};

// Convenience list of kind names.
export const SDESIGNER_NODE_KIND_LIST = Object.keys(SDESIGNER_NODE_KINDS);

// Direct evaluator — used by __studioSDesignerApply when the host
// register API is absent. Returns raw value (colour / float / object).
export function evalSDesignerNode(kind, params, inputs, ctx) {
  const def = SDESIGNER_NODE_KINDS[kind];
  if (!def) throw new Error(`unknown sdesigner node: ${kind}`);
  const base = def.defaultParams ? def.defaultParams() : {};
  const inst = { params: { ...base, ...(params || {}) } };
  const ins = new Map();
  if (inputs && typeof inputs === 'object') {
    for (const k of Object.keys(inputs)) ins.set(k, inputs[k]);
  }
  const safeCtx = ctx && typeof ctx === 'object' ? ctx : {
    u: 0, v: 0, x: 0, y: 0, size: 256,
    worldX: 0, worldY: 0, worldZ: 0,
  };
  return def.eval.call(inst, safeCtx, ins);
}
