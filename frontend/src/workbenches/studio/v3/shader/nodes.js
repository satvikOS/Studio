// ArchDisc Studio V3 — shader node-type registry.
//
// Each node kind exposes:
//   • title            — short label for the editor
//   • category         — palette grouping
//   • defaultParams()  — base param object cloned per instance
//   • inputs           — [{ name, type, default }]
//   • outputs          — [{ name, type }]
//   • eval(ctx, ins)   — evaluate node for the current per-pixel ctx,
//                        with `ins` being a Map<inputName, value> already
//                        resolved upstream.
//
// Types are duck-typed: 'color' is a length-3 [r,g,b] in 0..1; 'float' is
// a JS number; 'vec2' is [u,v]; 'any' lets a slot consume whatever the
// upstream produced (color → float averages; float → color replicates).
//
// `ctx` shape (built by graph.evaluate()):
//   { u, v, x, y, size, worldX, worldY, worldZ, noise(s, x, y) }

// ─── Helpers ─────────────────────────────────────────────────────────────
export function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
export function toColor(v) {
  if (Array.isArray(v) && v.length >= 3) return [+v[0] || 0, +v[1] || 0, +v[2] || 0];
  if (typeof v === 'number') return [v, v, v];
  if (v && typeof v === 'object' && v.r != null) return [+v.r || 0, +v.g || 0, +v.b || 0];
  return [0, 0, 0];
}
export function toFloat(v) {
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && v.length) {
    if (v.length >= 3) return (v[0] + v[1] + v[2]) / 3;
    return +v[0] || 0;
  }
  return 0;
}
export function toVec2(v) {
  if (Array.isArray(v) && v.length >= 2) return [+v[0] || 0, +v[1] || 0];
  if (typeof v === 'number') return [v, v];
  return [0, 0];
}
function mix(a, b, t) { return a + (b - a) * t; }
function lerpColor(a, b, t) {
  return [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
}

// Deterministic value-noise. Two-arg hash → 0..1.
export function hash2(x, y) {
  let h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  h -= Math.floor(h);
  return h;
}
export function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  // smoothstep blend
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return mix(mix(a, b, u), mix(c, d, u), v);
}

// ─── Node definitions ────────────────────────────────────────────────────
export const NODE_KINDS = {
  // Texture: maps the UV channel into a checker / stripes pattern (since
  // the engine has no file-loaded textures yet, this stands in for a
  // real image-texture node and is fully deterministic).
  texture: {
    title: 'Texture',
    category: 'input',
    defaultParams: () => ({ pattern: 'checker', scale: 4, a: [0.9, 0.9, 0.92], b: [0.18, 0.2, 0.24] }),
    inputs: [{ name: 'uv', type: 'vec2' }],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const uv = ins.has('uv') ? toVec2(ins.get('uv')) : [ctx.u, ctx.v];
      const s = Math.max(0.01, +this.params.scale || 4);
      const u = uv[0] * s, v = uv[1] * s;
      const pat = String(this.params.pattern || 'checker');
      const a = toColor(this.params.a);
      const b = toColor(this.params.b);
      if (pat === 'stripes') {
        return Math.floor(u) % 2 === 0 ? a : b;
      }
      if (pat === 'grid') {
        const fu = u - Math.floor(u); const fv = v - Math.floor(v);
        const line = (fu < 0.08 || fv < 0.08) ? 1 : 0;
        return line ? b : a;
      }
      // checker
      const cx = Math.floor(u) & 1; const cy = Math.floor(v) & 1;
      return (cx ^ cy) ? a : b;
    },
  },

  // Color ramp: 4 stops, linearly interpolated by the input float.
  colorramp: {
    title: 'ColorRamp',
    category: 'converter',
    defaultParams: () => ({
      stops: [
        { t: 0.0, color: [0, 0, 0] },
        { t: 0.33, color: [0.8, 0.2, 0.1] },
        { t: 0.66, color: [1.0, 0.85, 0.2] },
        { t: 1.0, color: [1, 1, 1] },
      ],
    }),
    inputs: [{ name: 'fac', type: 'float', default: 0.5 }],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const t = clamp01(toFloat(ins.get('fac')));
      const stops = (this.params.stops || []).slice().sort((p, q) => p.t - q.t);
      if (!stops.length) return [0, 0, 0];
      if (t <= stops[0].t) return toColor(stops[0].color);
      if (t >= stops[stops.length - 1].t) return toColor(stops[stops.length - 1].color);
      for (let i = 0; i < stops.length - 1; i++) {
        const s0 = stops[i], s1 = stops[i + 1];
        if (t >= s0.t && t <= s1.t) {
          const span = s1.t - s0.t || 1e-6;
          const k = (t - s0.t) / span;
          return lerpColor(toColor(s0.color), toColor(s1.color), k);
        }
      }
      return toColor(stops[stops.length - 1].color);
    },
  },

  // Math node: scalar ops over two inputs.
  math: {
    title: 'Math',
    category: 'converter',
    defaultParams: () => ({ op: 'add' }),
    inputs: [
      { name: 'a', type: 'float', default: 0 },
      { name: 'b', type: 'float', default: 0 },
    ],
    outputs: [{ name: 'value', type: 'float' }],
    eval(ctx, ins) {
      const a = toFloat(ins.get('a'));
      const b = toFloat(ins.get('b'));
      const op = String(this.params.op || 'add');
      switch (op) {
        case 'add':   return a + b;
        case 'sub':   return a - b;
        case 'mul':   return a * b;
        case 'div':   return b === 0 ? 0 : a / b;
        case 'min':   return Math.min(a, b);
        case 'max':   return Math.max(a, b);
        case 'pow':   return Math.pow(Math.max(0, a), b);
        case 'clamp': return Math.max(a, Math.min(b, toFloat(ins.get('a'))));
        default:      return a + b;
      }
    },
  },

  // Mix: lerp two colors by a float.
  mix: {
    title: 'Mix',
    category: 'converter',
    defaultParams: () => ({}),
    inputs: [
      { name: 'fac', type: 'float', default: 0.5 },
      { name: 'a', type: 'color', default: [0, 0, 0] },
      { name: 'b', type: 'color', default: [1, 1, 1] },
    ],
    outputs: [{ name: 'color', type: 'color' }],
    eval(ctx, ins) {
      const t = clamp01(toFloat(ins.get('fac')));
      const a = toColor(ins.get('a'));
      const b = toColor(ins.get('b'));
      return lerpColor(a, b, t);
    },
  },

  // Geometry: surfaces UV / world-position to the graph.
  geometry: {
    title: 'Geometry',
    category: 'input',
    defaultParams: () => ({}),
    inputs: [],
    outputs: [
      { name: 'uv', type: 'vec2' },
      { name: 'worldPos', type: 'color' },
    ],
    eval(ctx /* , ins */) {
      // The graph dispatches by output name in resolveSlot. Return a
      // map-shaped object so the dispatcher can pull the right key.
      return {
        uv: [ctx.u, ctx.v],
        worldPos: [ctx.worldX, ctx.worldY, ctx.worldZ],
      };
    },
    multiOutput: true,
  },

  // RGB constant color.
  rgb: {
    title: 'RGB',
    category: 'input',
    defaultParams: () => ({ color: [0.8, 0.3, 0.5] }),
    inputs: [],
    outputs: [{ name: 'color', type: 'color' }],
    eval(/* ctx, ins */) { return toColor(this.params.color); },
  },

  // Constant float value.
  value: {
    title: 'Value',
    category: 'input',
    defaultParams: () => ({ value: 0.5 }),
    inputs: [],
    outputs: [{ name: 'value', type: 'float' }],
    eval(/* ctx, ins */) { return +this.params.value || 0; },
  },

  // Noise: value-noise sampled in UV (optionally driven by 'vector' input).
  noise: {
    title: 'Noise',
    category: 'texture',
    defaultParams: () => ({ scale: 8, octaves: 1, seed: 0 }),
    inputs: [{ name: 'vector', type: 'vec2' }],
    outputs: [
      { name: 'fac', type: 'float' },
      { name: 'color', type: 'color' },
    ],
    multiOutput: true,
    eval(ctx, ins) {
      const v = ins.has('vector') ? toVec2(ins.get('vector')) : [ctx.u, ctx.v];
      const s = Math.max(0.01, +this.params.scale || 8);
      const o = Math.max(1, Math.min(4, Math.floor(+this.params.octaves || 1)));
      const seed = +this.params.seed || 0;
      let amp = 1, sum = 0, norm = 0;
      let fx = v[0] * s + seed * 13.31;
      let fy = v[1] * s + seed * 7.91;
      for (let i = 0; i < o; i++) {
        sum += valueNoise(fx, fy) * amp;
        norm += amp;
        amp *= 0.5;
        fx *= 2; fy *= 2;
      }
      const f = sum / (norm || 1);
      return { fac: f, color: [f, f, f] };
    },
  },

  // Output: terminal node. Reads its `color` input and forwards it.
  output: {
    title: 'Output',
    category: 'output',
    defaultParams: () => ({}),
    inputs: [{ name: 'color', type: 'color', default: [0.5, 0.5, 0.5] }],
    outputs: [],
    eval(ctx, ins) {
      return toColor(ins.get('color'));
    },
  },
};

// Tiny helper used by the editor + graph: list of registered kind names.
export function listKinds() { return Object.keys(NODE_KINDS); }

// Build an instance descriptor with a fresh uuid + params clone.
let _uuid = 0;
export function makeNode(kind, params) {
  const def = NODE_KINDS[kind];
  if (!def) throw new Error(`unknown shader node kind: ${kind}`);
  const id = `n_${Date.now().toString(36)}_${(_uuid++).toString(36)}`;
  return {
    id,
    kind,
    title: def.title,
    params: { ...def.defaultParams(), ...(params || {}) },
    x: 0,
    y: 0,
  };
}
