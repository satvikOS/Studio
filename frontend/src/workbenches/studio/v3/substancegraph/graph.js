// Slice 716 — Substance Designer node graph. Visual procedural
// material authoring. Each node outputs RGBA Float32Array buffers
// (compatible with slice-696 sdesigner / slice-702 sdesignpro);
// edges carry buffers; output nodes are exported as named PBR slots
// (baseColor / roughness / metalness / normal / height).

const _graphs = new Map();
let _seq = 1;
function _uid() { return `sg-${_seq++}-${Date.now().toString(36)}`; }

const NODE_DEFS = {
  // Sources.
  noise: { in: [], out: ['out'], compute: (n) => {
    const size = n.params.size || 256;
    return _genHashNoise(size, n.params.scale || 8);
  } },
  perlin: { in: [], out: ['out'], compute: (n) => {
    return _genPerlin(n.params.size || 256, n.params.frequency || 6);
  } },
  cells: { in: [], out: ['out'], compute: (n) => {
    return _genCells(n.params.size || 256, n.params.cellCount || 12);
  } },
  uniform: { in: [], out: ['out'], compute: (n) => {
    const size = n.params.size || 256;
    return _genUniform(size, n.params.color || [0.5, 0.5, 0.5]);
  } },
  tileSampler: { in: [], out: ['out'], compute: (n) => {
    if (typeof window.__studioSDesignProTileSampler === 'function') {
      const r = window.__studioSDesignProTileSampler(n.params);
      return r.ok ? { buf: r.buf, size: r.size } : null;
    }
    return _genUniform(256, [0.5, 0.5, 0.5]);
  } },
  // Blending / math.
  add: { in: ['a', 'b'], out: ['out'], compute: (n, ins) => _blendPixelOp(ins.a, ins.b, (a, b) => a + b) },
  multiply: { in: ['a', 'b'], out: ['out'], compute: (n, ins) => _blendPixelOp(ins.a, ins.b, (a, b) => a * b) },
  screen: { in: ['a', 'b'], out: ['out'], compute: (n, ins) => _blendPixelOp(ins.a, ins.b, (a, b) => 1 - (1 - a) * (1 - b)) },
  blend: { in: ['a', 'b', 'mask'], out: ['out'], compute: (n, ins) => _blendMasked(ins.a, ins.b, ins.mask) },
  invert: { in: ['in'], out: ['out'], compute: (n, ins) => _pixelOp(ins.in, (v) => 1 - v) },
  levels: { in: ['in'], out: ['out'], compute: (n, ins) => {
    const lo = n.params.lo ?? 0;
    const hi = n.params.hi ?? 1;
    const g = n.params.gamma ?? 1;
    return _pixelOp(ins.in, (v) => {
      const t = Math.max(0, Math.min(1, (v - lo) / Math.max(1e-6, hi - lo)));
      return Math.pow(t, 1 / g);
    });
  } },
  hsl: { in: ['in'], out: ['out'], compute: (n, ins) => _hslOp(ins.in, n.params.h || 0, n.params.s || 1, n.params.l || 0) },
  // Sinks.
  out_baseColor: { in: ['in'], out: [], compute: (n, ins) => { _outputs.baseColor = ins.in; return null; } },
  out_roughness: { in: ['in'], out: [], compute: (n, ins) => { _outputs.roughness = ins.in; return null; } },
  out_metalness: { in: ['in'], out: [], compute: (n, ins) => { _outputs.metalness = ins.in; return null; } },
  out_normal: { in: ['in'], out: [], compute: (n, ins) => { _outputs.normal = ins.in; return null; } },
  out_height: { in: ['in'], out: [], compute: (n, ins) => { _outputs.height = ins.in; return null; } },
};

const _outputs = { baseColor: null, roughness: null, metalness: null, normal: null, height: null };

function _genHashNoise(size, scale) {
  const buf = new Float32Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x / size) * scale);
      const sy = Math.floor((y / size) * scale);
      const h = Math.sin(sx * 12.9898 + sy * 78.233) * 43758.5453;
      const v = h - Math.floor(h);
      const i = (y * size + x) * 4;
      buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = 1;
    }
  }
  return { buf, size };
}

function _genPerlin(size, freq) {
  const buf = new Float32Array(size * size * 4);
  const grad = new Float32Array(64);
  for (let i = 0; i < 64; i++) grad[i] = Math.random() * 2 - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * freq, v = (y / size) * freq;
      const fu = Math.floor(u), fv = Math.floor(v);
      const a = grad[(fu * 7 + fv * 17) & 63];
      const b = grad[((fu + 1) * 7 + fv * 17) & 63];
      const c = grad[(fu * 7 + (fv + 1) * 17) & 63];
      const d = grad[((fu + 1) * 7 + (fv + 1) * 17) & 63];
      const tx = u - fu, ty = v - fv;
      const top = a * (1 - tx) + b * tx;
      const bot = c * (1 - tx) + d * tx;
      const val = (top * (1 - ty) + bot * ty) * 0.5 + 0.5;
      const i = (y * size + x) * 4;
      buf[i] = val; buf[i + 1] = val; buf[i + 2] = val; buf[i + 3] = 1;
    }
  }
  return { buf, size };
}

function _genCells(size, cells) {
  const cellPoints = [];
  for (let i = 0; i < cells * cells; i++) {
    cellPoints.push([Math.random() * size, Math.random() * size]);
  }
  const buf = new Float32Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let minD = Infinity;
      for (const p of cellPoints) {
        const d = (x - p[0]) ** 2 + (y - p[1]) ** 2;
        if (d < minD) minD = d;
      }
      const v = Math.min(1, Math.sqrt(minD) / (size / cells));
      const i = (y * size + x) * 4;
      buf[i] = v; buf[i + 1] = v; buf[i + 2] = v; buf[i + 3] = 1;
    }
  }
  return { buf, size };
}

function _genUniform(size, color) {
  const buf = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    buf[i * 4] = color[0]; buf[i * 4 + 1] = color[1]; buf[i * 4 + 2] = color[2]; buf[i * 4 + 3] = 1;
  }
  return { buf, size };
}

function _blendPixelOp(a, b, fn) {
  if (!a || !b) return a || b;
  const size = Math.min(a.size, b.size);
  const out = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4]     = Math.max(0, Math.min(1, fn(a.buf[i * 4]     || 0, b.buf[i * 4]     || 0)));
    out[i * 4 + 1] = Math.max(0, Math.min(1, fn(a.buf[i * 4 + 1] || 0, b.buf[i * 4 + 1] || 0)));
    out[i * 4 + 2] = Math.max(0, Math.min(1, fn(a.buf[i * 4 + 2] || 0, b.buf[i * 4 + 2] || 0)));
    out[i * 4 + 3] = 1;
  }
  return { buf: out, size };
}

function _blendMasked(a, b, mask) {
  if (!a) return b;
  if (!b) return a;
  if (!mask) return a;
  const size = Math.min(a.size, b.size, mask.size);
  const out = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const m = mask.buf[i * 4];
    out[i * 4]     = a.buf[i * 4]     * (1 - m) + b.buf[i * 4]     * m;
    out[i * 4 + 1] = a.buf[i * 4 + 1] * (1 - m) + b.buf[i * 4 + 1] * m;
    out[i * 4 + 2] = a.buf[i * 4 + 2] * (1 - m) + b.buf[i * 4 + 2] * m;
    out[i * 4 + 3] = 1;
  }
  return { buf: out, size };
}

function _pixelOp(in_, fn) {
  if (!in_) return null;
  const size = in_.size;
  const out = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    out[i * 4]     = Math.max(0, Math.min(1, fn(in_.buf[i * 4]     || 0)));
    out[i * 4 + 1] = Math.max(0, Math.min(1, fn(in_.buf[i * 4 + 1] || 0)));
    out[i * 4 + 2] = Math.max(0, Math.min(1, fn(in_.buf[i * 4 + 2] || 0)));
    out[i * 4 + 3] = 1;
  }
  return { buf: out, size };
}

function _hslOp(in_, hShift, sScale, lShift) {
  if (!in_) return null;
  const size = in_.size;
  const out = new Float32Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const r = in_.buf[i * 4], g = in_.buf[i * 4 + 1], b = in_.buf[i * 4 + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    h = (h + hShift) % 1; if (h < 0) h += 1;
    s = Math.max(0, Math.min(1, s * sScale));
    l = Math.max(0, Math.min(1, l + lShift));
    const _hue = (t) => {
      t = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
      if (t < 1 / 6) return (l < 0.5 ? l * (1 + s) : l + s - l * s) - ((l < 0.5 ? l * (1 + s) : l + s - l * s) - (2 * l - (l < 0.5 ? l * (1 + s) : l + s - l * s))) * (1 - 6 * t);
      if (t < 0.5) return l < 0.5 ? l * (1 + s) : l + s - l * s;
      if (t < 2 / 3) return (2 * l - (l < 0.5 ? l * (1 + s) : l + s - l * s)) + ((l < 0.5 ? l * (1 + s) : l + s - l * s) - (2 * l - (l < 0.5 ? l * (1 + s) : l + s - l * s))) * (2 / 3 - t) * 6;
      return 2 * l - (l < 0.5 ? l * (1 + s) : l + s - l * s);
    };
    out[i * 4]     = _hue(h + 1 / 3);
    out[i * 4 + 1] = _hue(h);
    out[i * 4 + 2] = _hue(h - 1 / 3);
    out[i * 4 + 3] = 1;
  }
  return { buf: out, size };
}

export function createGraph() {
  const id = _uid();
  _graphs.set(id, { id, nodes: [], edges: [] });
  return { ok: true, id };
}

export function addNode(graphId, kind, params) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  if (!NODE_DEFS[kind]) return { ok: false };
  const uuid = _uid();
  g.nodes.push({ uuid, kind, params: params || {} });
  return { ok: true, uuid };
}

export function connect(graphId, fromUuid, toUuid, toIn) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  g.edges = g.edges.filter((e) => !(e.toUuid === toUuid && e.toIn === toIn));
  g.edges.push({ fromUuid, toUuid, toIn });
  return { ok: true };
}

export function cook(graphId) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  _outputs.baseColor = null;
  _outputs.roughness = null;
  _outputs.metalness = null;
  _outputs.normal = null;
  _outputs.height = null;
  const cache = new Map();
  const visiting = new Set();
  function _val(uuid) {
    if (cache.has(uuid)) return cache.get(uuid);
    if (visiting.has(uuid)) return null;
    visiting.add(uuid);
    const node = g.nodes.find((n) => n.uuid === uuid);
    if (!node) { visiting.delete(uuid); return null; }
    const def = NODE_DEFS[node.kind];
    const ins = {};
    for (const slot of def.in) {
      const e = g.edges.find((x) => x.toUuid === uuid && x.toIn === slot);
      if (e) ins[slot] = _val(e.fromUuid);
    }
    let out;
    try { out = def.compute(node, ins); } catch (_) { out = null; }
    visiting.delete(uuid);
    cache.set(uuid, out);
    return out;
  }
  for (const n of g.nodes) if (n.kind.startsWith('out_')) _val(n.uuid);
  return { ok: true, outputs: { ..._outputs } };
}

export function getOutputs() { return { ok: true, outputs: { ..._outputs } }; }

export function listNodes(graphId) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  return { ok: true, nodes: g.nodes.map((n) => ({ uuid: n.uuid, kind: n.kind, params: n.params })), edges: g.edges.slice() };
}

export function listKinds() {
  return { ok: true, kinds: Object.entries(NODE_DEFS).map(([k, d]) => ({ kind: k, in: d.in, out: d.out })) };
}
