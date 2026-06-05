// ArchDisc Studio V3 — 20 deeper Cycles-style shader-node definitions.
//
// Each definition mirrors the slice-684 shader-node contract
// (frontend/src/workbenches/studio/v3/shader/nodes.js):
//
//   {
//     title, category,
//     defaultParams(),
//     inputs:  [{ name, type, default }],
//     outputs: [{ name, type }],
//     eval(ctx, ins) → value
//     multiOutput?  // if eval returns { outputName: value, … }
//   }
//
// `ctx` shape (built by graph.evaluate()):
//   { u, v, x, y, size, worldX, worldY, worldZ }
//
// `ins` is a Map<inputName, resolvedValue> already converted upstream.
// `value` is either a length-3 colour [r,g,b] (0..1), a JS number, a
// length-2 vec2 [u,v], or a length-3 vec3 — same duck-typing the host
// graph supports.
//
// These nodes operate purely on the per-pixel evaluator. They never
// touch three.js directly — three.js + React only at the host layer.

// ─── Helpers (mirror shader/nodes.js — duplicated so this module is
//     self-contained and registers cleanly when shader/ is absent). ──
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
function toVec3(v) {
  if (Array.isArray(v) && v.length >= 3) return [+v[0] || 0, +v[1] || 0, +v[2] || 0];
  if (Array.isArray(v) && v.length >= 2) return [+v[0] || 0, +v[1] || 0, 0];
  if (typeof v === 'number') return [v, v, v];
  return [0, 0, 0];
}
function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  h -= Math.floor(h);
  return h;
}
function hash3(x, y, z) {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  h -= Math.floor(h);
  return h;
}
function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fract(x) { return x - Math.floor(x); }

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

// ─── 20 node definitions ─────────────────────────────────────────────
export const MORE_NODE_KINDS = {
  // 1 — Brick: procedural brick pattern with mortar.
  brick: {
    title: 'Brick',
    category: 'texture',
    defaultParams: () => ({
      scale: 6, mortarSize: 0.05, brickWidth: 0.5, brickHeight: 0.25,
      color1: [0.62, 0.20, 0.18], color2: [0.70, 0.28, 0.22],
      mortar: [0.08, 0.08, 0.08],
    }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac', type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.001, +this.params.scale || 6);
      const bw = Math.max(0.001, +this.params.brickWidth || 0.5);
      const bh = Math.max(0.001, +this.params.brickHeight || 0.25);
      const m = clamp01(+this.params.mortarSize || 0);
      const u = uv[0] * s;
      const v = uv[1] * s;
      const row = Math.floor(v / bh);
      const off = (row & 1) ? bw * 0.5 : 0;
      const fu = fract((u + off) / bw);
      const fv = fract(v / bh);
      const isMortar = (fu < m || fu > 1 - m || fv < m || fv > 1 - m) ? 1 : 0;
      if (isMortar) return { color: toColor(this.params.mortar), fac: 1 };
      const idx = hash2(Math.floor((u + off) / bw), row);
      const c = idx < 0.5 ? toColor(this.params.color1) : toColor(this.params.color2);
      return { color: c, fac: 0 };
    },
  },

  // 2 — Wave: sinusoidal waves.
  wave: {
    title: 'Wave',
    category: 'texture',
    defaultParams: () => ({
      pattern: 'bands', direction: 0, frequency: 6, phase: 0, distortion: 0,
    }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'fac', type: 'float' },
      { name: 'color', type: 'color' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const dir = (+this.params.direction || 0) * Math.PI / 180;
      const freq = +this.params.frequency || 6;
      const phase = +this.params.phase || 0;
      const dist = +this.params.distortion || 0;
      const pat = String(this.params.pattern || 'bands');
      const cs = Math.cos(dir), sn = Math.sin(dir);
      const t = uv[0] * cs + uv[1] * sn;
      const r = uv[0] * -sn + uv[1] * cs;
      const noise = dist * (hash2(uv[0] * 10, uv[1] * 10) - 0.5);
      let x;
      if (pat === 'rings') x = Math.sqrt(t * t + r * r);
      else x = t;
      const f = 0.5 + 0.5 * Math.sin((x * freq + phase + noise) * Math.PI * 2);
      return { fac: f, color: [f, f, f] };
    },
  },

  // 3 — Magic: Blender's Magic Texture — layered sin/cos.
  magic: {
    title: 'Magic',
    category: 'texture',
    defaultParams: () => ({ depth: 2, distortion: 1, scale: 5 }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac', type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = +this.params.scale || 5;
      const dis = +this.params.distortion || 1;
      const depth = Math.max(0, Math.min(10, Math.floor(+this.params.depth || 2)));
      let x = Math.sin((uv[0] + uv[1]) * s);
      let y = Math.cos((uv[1] - uv[0]) * s);
      let z = -Math.cos(-uv[0] * uv[1] * s);
      for (let i = 0; i < depth; i++) {
        const nx = -Math.cos(x - y + z) * dis;
        const ny = -Math.cos(-x + y - z) * dis;
        const nz = Math.sin(x + y + z) * dis;
        x = nx; y = ny; z = nz;
      }
      if (dis !== 0) { x /= dis; y /= dis; z /= dis; }
      const r = clamp01(0.5 - x * 0.5);
      const g = clamp01(0.5 - y * 0.5);
      const b = clamp01(0.5 - z * 0.5);
      return { color: [r, g, b], fac: (r + g + b) / 3 };
    },
  },

  // 4 — Musgrave: fractal noise variant.
  musgrave: {
    title: 'Musgrave',
    category: 'texture',
    defaultParams: () => ({ H: 1.0, lacunarity: 2.0, octaves: 4, scale: 6 }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [{ name: 'fac', type: 'float' }],
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const H = clampR(+this.params.H || 1, 0.001, 2);
      const lac = +this.params.lacunarity || 2;
      const oct = Math.max(1, Math.min(8, Math.floor(+this.params.octaves || 4)));
      const s = +this.params.scale || 6;
      let x = uv[0] * s, y = uv[1] * s;
      let sum = 0;
      let amp = 1;
      let freq = 1;
      for (let i = 0; i < oct; i++) {
        sum += (valueNoise(x * freq, y * freq) * 2 - 1) * Math.pow(amp, -H);
        amp *= lac;
        freq *= lac;
      }
      return clamp01(0.5 + 0.5 * sum);
    },
  },

  // 5 — Voronoi: closest-feature distance / cell index.
  voronoi: {
    title: 'Voronoi',
    category: 'texture',
    defaultParams: () => ({ scale: 8, randomness: 1, mode: 'distance' }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [
      { name: 'distance', type: 'float' },
      { name: 'color', type: 'color' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.01, +this.params.scale || 8);
      const rnd = clamp01(+this.params.randomness ?? 1);
      const px = uv[0] * s, py = uv[1] * s;
      const cx = Math.floor(px), cy = Math.floor(py);
      let best = 9e9, bx = 0, by = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const gx = cx + dx, gy = cy + dy;
          const ox = hash2(gx, gy);
          const oy = hash2(gy, gx + 17);
          const fx = gx + 0.5 + (ox - 0.5) * rnd;
          const fy = gy + 0.5 + (oy - 0.5) * rnd;
          const ddx = fx - px, ddy = fy - py;
          const d = ddx * ddx + ddy * ddy;
          if (d < best) { best = d; bx = gx; by = gy; }
        }
      }
      const dist = Math.sqrt(best);
      const r = hash2(bx + 0.1, by + 0.3);
      const g = hash2(bx + 0.7, by + 0.5);
      const b = hash2(bx + 1.3, by + 1.1);
      return { distance: clamp01(dist), color: [r, g, b] };
    },
  },

  // 6 — Checker3D: 3D checker using worldPos.
  checker3d: {
    title: 'Checker3D',
    category: 'texture',
    defaultParams: () => ({ scale: 4, a: [0.95, 0.95, 0.95], b: [0.1, 0.1, 0.1] }),
    inputs: [{ name: 'vector', type: 'vec3' }],
    outputs: [
      { name: 'color', type: 'color' },
      { name: 'fac', type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      let p;
      if (ins.has('vector')) p = toVec3(ins.get('vector'));
      else p = [ctx.worldX || 0, ctx.worldY || 0, ctx.worldZ || 0];
      const s = Math.max(0.001, +this.params.scale || 4);
      const cx = Math.floor(p[0] * s) & 1;
      const cy = Math.floor(p[1] * s) & 1;
      const cz = Math.floor(p[2] * s) & 1;
      const on = (cx ^ cy ^ cz);
      return { color: on ? toColor(this.params.a) : toColor(this.params.b), fac: on };
    },
  },

  // 7 — Gradient3D: linear/radial/spherical gradient.
  gradient3d: {
    title: 'Gradient3D',
    category: 'texture',
    defaultParams: () => ({ mode: 'linear', axis: 'x' }),
    inputs: [{ name: 'vector', type: 'vec3' }],
    outputs: [
      { name: 'fac', type: 'float' },
      { name: 'color', type: 'color' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      let p;
      if (ins.has('vector')) p = toVec3(ins.get('vector'));
      else p = [ctx.u, ctx.v, 0];
      const mode = String(this.params.mode || 'linear');
      const axis = String(this.params.axis || 'x');
      let f = 0;
      if (mode === 'radial') {
        f = Math.atan2(p[1] - 0.5, p[0] - 0.5) / (Math.PI * 2) + 0.5;
      } else if (mode === 'spherical') {
        const dx = p[0] - 0.5, dy = p[1] - 0.5, dz = p[2];
        f = 1 - clamp01(Math.sqrt(dx * dx + dy * dy + dz * dz) * 2);
      } else {
        f = axis === 'y' ? p[1] : axis === 'z' ? p[2] : p[0];
      }
      const c = clamp01(f);
      return { fac: c, color: [c, c, c] };
    },
  },

  // 8 — Hue/Saturation/Value.
  hsv: {
    title: 'Hue Saturation Value',
    category: 'color',
    defaultParams: () => ({ hue: 0.5, saturation: 1, value: 1, fac: 1 }),
    inputs: [
      { name: 'fac', type: 'float', default: 1 },
      { name: 'color', type: 'color', default: [1, 1, 1] },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const c = toColor(ins.get('color'));
      const dh = (+this.params.hue ?? 0.5) - 0.5;
      const ds = +this.params.saturation ?? 1;
      const dv = +this.params.value ?? 1;
      const hsv = rgb2hsv(c[0], c[1], c[2]);
      const out = hsv2rgb((hsv[0] + dh + 1) % 1, clamp01(hsv[1] * ds), Math.max(0, hsv[2] * dv));
      const f = clamp01(toFloat(ins.get('fac')));
      return [
        c[0] * (1 - f) + out[0] * f,
        c[1] * (1 - f) + out[1] * f,
        c[2] * (1 - f) + out[2] * f,
      ];
    },
  },

  // 9 — InvertColor: 1 - rgb.
  invertcolor: {
    title: 'Invert',
    category: 'color',
    defaultParams: () => ({ fac: 1 }),
    inputs: [
      { name: 'fac', type: 'float', default: 1 },
      { name: 'color', type: 'color', default: [0, 0, 0] },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const c = toColor(ins.get('color'));
      const f = clamp01(ins.has('fac') ? toFloat(ins.get('fac')) : (+this.params.fac ?? 1));
      const inv = [1 - c[0], 1 - c[1], 1 - c[2]];
      return [
        c[0] * (1 - f) + inv[0] * f,
        c[1] * (1 - f) + inv[1] * f,
        c[2] * (1 - f) + inv[2] * f,
      ];
    },
  },

  // 10 — Gamma: pow(color, 1/gamma).
  gamma: {
    title: 'Gamma',
    category: 'color',
    defaultParams: () => ({ gamma: 2.2 }),
    inputs: [
      { name: 'color', type: 'color', default: [0.5, 0.5, 0.5] },
      { name: 'gamma', type: 'float', default: 2.2 },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const c = toColor(ins.get('color'));
      const g = Math.max(0.001, ins.has('gamma') ? toFloat(ins.get('gamma')) : (+this.params.gamma || 2.2));
      const inv = 1 / g;
      return [
        Math.pow(Math.max(0, c[0]), inv),
        Math.pow(Math.max(0, c[1]), inv),
        Math.pow(Math.max(0, c[2]), inv),
      ];
    },
  },

  // 11 — Bright/Contrast.
  brightcontrast: {
    title: 'Bright Contrast',
    category: 'color',
    defaultParams: () => ({ bright: 0, contrast: 0 }),
    inputs: [
      { name: 'color', type: 'color', default: [0.5, 0.5, 0.5] },
      { name: 'bright', type: 'float', default: 0 },
      { name: 'contrast', type: 'float', default: 0 },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const c = toColor(ins.get('color'));
      const br = ins.has('bright') ? toFloat(ins.get('bright')) : (+this.params.bright || 0);
      const co = ins.has('contrast') ? toFloat(ins.get('contrast')) : (+this.params.contrast || 0);
      // Blender's formula: out = (in - 0.5) * (1 + contrast) + 0.5 + bright.
      const k = 1 + co;
      return [
        clamp01((c[0] - 0.5) * k + 0.5 + br),
        clamp01((c[1] - 0.5) * k + 0.5 + br),
        clamp01((c[2] - 0.5) * k + 0.5 + br),
      ];
    },
  },

  // 12a — ColorAdd.
  coloradd: {
    title: 'Color Add',
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
      return [a[0] + b[0] * f, a[1] + b[1] * f, a[2] + b[2] * f];
    },
  },

  // 12b — ColorSub.
  colorsub: {
    title: 'Color Subtract',
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
      return [a[0] - b[0] * f, a[1] - b[1] * f, a[2] - b[2] * f];
    },
  },

  // 12c — ColorMul.
  colormul: {
    title: 'Color Multiply',
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

  // 12d — ColorDiv.
  colordiv: {
    title: 'Color Divide',
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
      const d = [
        b[0] === 0 ? 0 : a[0] / b[0],
        b[1] === 0 ? 0 : a[1] / b[1],
        b[2] === 0 ? 0 : a[2] / b[2],
      ];
      return [
        a[0] * (1 - f) + d[0] * f,
        a[1] * (1 - f) + d[1] * f,
        a[2] * (1 - f) + d[2] * f,
      ];
    },
  },

  // 13 — Separate RGB.
  separatergb: {
    title: 'Separate RGB',
    category: 'converter',
    defaultParams: () => ({}),
    inputs: [{ name: 'color', type: 'color', default: [0, 0, 0] }],
    outputs: [
      { name: 'r', type: 'float' },
      { name: 'g', type: 'float' },
      { name: 'b', type: 'float' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const c = toColor(ins.get('color'));
      return { r: c[0], g: c[1], b: c[2] };
    },
  },

  // 14 — Combine RGB.
  combinergb: {
    title: 'Combine RGB',
    category: 'converter',
    defaultParams: () => ({ r: 0, g: 0, b: 0 }),
    inputs: [
      { name: 'r', type: 'float', default: 0 },
      { name: 'g', type: 'float', default: 0 },
      { name: 'b', type: 'float', default: 0 },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const r = ins.has('r') ? toFloat(ins.get('r')) : (+this.params.r || 0);
      const g = ins.has('g') ? toFloat(ins.get('g')) : (+this.params.g || 0);
      const b = ins.has('b') ? toFloat(ins.get('b')) : (+this.params.b || 0);
      return [r, g, b];
    },
  },

  // 15 — Dot product.
  dot: {
    title: 'Dot Product',
    category: 'vector',
    defaultParams: () => ({}),
    inputs: [
      { name: 'a', type: 'vec3', default: [0, 0, 0] },
      { name: 'b', type: 'vec3', default: [0, 0, 0] },
    ],
    outputs: [{ name: 'value', type: 'float' }],
    eval(ctx, ins) {
      const a = toVec3(ins.get('a'));
      const b = toVec3(ins.get('b'));
      return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    },
  },

  // 16 — Length.
  length: {
    title: 'Length',
    category: 'vector',
    defaultParams: () => ({}),
    inputs: [{ name: 'vector', type: 'vec3', default: [0, 0, 0] }],
    outputs: [{ name: 'value', type: 'float' }],
    eval(ctx, ins) {
      const v = toVec3(ins.get('vector'));
      return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    },
  },

  // 17 — Distance.
  distance: {
    title: 'Distance',
    category: 'vector',
    defaultParams: () => ({}),
    inputs: [
      { name: 'a', type: 'vec3', default: [0, 0, 0] },
      { name: 'b', type: 'vec3', default: [0, 0, 0] },
    ],
    outputs: [{ name: 'value', type: 'float' }],
    eval(ctx, ins) {
      const a = toVec3(ins.get('a'));
      const b = toVec3(ins.get('b'));
      const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
      return Math.sqrt(dx * dx + dy * dy + dz * dz);
    },
  },

  // 18 — Normal Map.
  normalmap: {
    title: 'Normal Map',
    category: 'vector',
    defaultParams: () => ({ strength: 1 }),
    inputs: [
      { name: 'color', type: 'color', default: [0.5, 0.5, 1] },
      { name: 'strength', type: 'float', default: 1 },
    ],
    outputs: [{ name: 'normal', type: 'color' }],
    eval(ctx, ins) {
      const c = toColor(ins.get('color'));
      // Map [0..1] → [-1..1] for x,y; keep z mostly upright.
      const str = ins.has('strength') ? toFloat(ins.get('strength')) : (+this.params.strength ?? 1);
      const nx = (c[0] * 2 - 1) * str;
      const ny = (c[1] * 2 - 1) * str;
      const nz = c[2] * 2 - 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      // Emit a colour-coded normal — [-1..1] mapped back into [0..1].
      return [nx / len * 0.5 + 0.5, ny / len * 0.5 + 0.5, nz / len * 0.5 + 0.5];
    },
  },

  // 19 — Fresnel.
  fresnel: {
    title: 'Fresnel',
    category: 'shader',
    defaultParams: () => ({ power: 5, ior: 1.45 }),
    inputs: [
      { name: 'normal', type: 'vec3', default: [0, 0, 1] },
      { name: 'power', type: 'float', default: 5 },
    ],
    outputs: [{ name: 'fac', type: 'float' }],
    eval(ctx, ins) {
      // No real camera here — approximate view dir as +Z and normal map
      // input as a perturbed normal centred on +Z. Mix with worldY for
      // a usable angular falloff in the bake.
      const n = toVec3(ins.get('normal'));
      const len = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) || 1;
      const nz = n[2] / len;
      const power = ins.has('power') ? toFloat(ins.get('power')) : (+this.params.power || 5);
      const dotNV = Math.max(0, Math.min(1, Math.abs(nz)));
      return Math.pow(1 - dotNV, Math.max(0.001, power));
    },
  },

  // 20 — AO Fake.
  aofake: {
    title: 'AO Fake',
    category: 'shader',
    defaultParams: () => ({ radius: 1, strength: 1 }),
    inputs: [{ name: 'vector', type: 'vec3' }],
    outputs: [{ name: 'fac', type: 'float' }],
    eval(ctx, ins) {
      let p;
      if (ins.has('vector')) p = toVec3(ins.get('vector'));
      else p = [ctx.worldX || 0, ctx.worldY || 0, ctx.worldZ || 0];
      const r = Math.max(0.001, +this.params.radius || 1);
      const str = clampR(+this.params.strength ?? 1, 0, 4);
      // Distance from origin — fade darker as the point approaches y=0.
      const dist = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
      const closeness = 1 - Math.min(1, dist / r);
      // Add a tiny crevice darken using local hash3 to mimic surface dirt.
      const dirt = hash3(p[0] * 4, p[1] * 4, p[2] * 4) * 0.15;
      return clamp01(1 - (closeness * str + dirt));
    },
  },
};

// Convenience list of new kind names.
export const MORE_NODE_KIND_LIST = Object.keys(MORE_NODE_KINDS);

// Direct evaluator — used by __studioShaderDeepApply when the slice-684
// register API is absent. Returns the raw value (colour / float / map).
export function evalMoreNode(kind, params, inputs, ctx) {
  const def = MORE_NODE_KINDS[kind];
  if (!def) throw new Error(`unknown shaderdeep node: ${kind}`);
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
