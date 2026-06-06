// Slice 713 — Cinema 4D XPresso visual scripting. Node graph with
// typed sockets where each node fires on a tick to (1) read source
// node values, (2) compute outputs, (3) drive a sink such as a
// transform property on a scene object. Sinks include
// objectTransform / materialColor / lightIntensity / studioOp.

const _graphs = new Map();
let _seq = 1;
function _uid() { return `xp-${_seq++}-${Date.now().toString(36)}`; }

const NODE_DEFS = {
  // Sources.
  const_f: { in: [], out: ['v'], compute: (n) => Number(n.params.value) || 0 },
  const_v: { in: [], out: ['v'], compute: (n) => [Number(n.params.x), Number(n.params.y), Number(n.params.z)] },
  time: { in: [], out: ['v'], compute: () => performance.now() * 0.001 },
  mouseX: { in: [], out: ['v'], compute: () => (window.__studioMouseX || 0) / window.innerWidth },
  mouseY: { in: [], out: ['v'], compute: () => (window.__studioMouseY || 0) / window.innerHeight },
  random: { in: [], out: ['v'], compute: () => Math.random() },
  // Operations.
  add: { in: ['a', 'b'], out: ['v'], compute: (n, ins) => _toN(ins.a) + _toN(ins.b) },
  sub: { in: ['a', 'b'], out: ['v'], compute: (n, ins) => _toN(ins.a) - _toN(ins.b) },
  mul: { in: ['a', 'b'], out: ['v'], compute: (n, ins) => _toN(ins.a) * _toN(ins.b) },
  div: { in: ['a', 'b'], out: ['v'], compute: (n, ins) => _toN(ins.a) / (_toN(ins.b) || 1) },
  sin: { in: ['x'], out: ['v'], compute: (n, ins) => Math.sin(_toN(ins.x)) },
  cos: { in: ['x'], out: ['v'], compute: (n, ins) => Math.cos(_toN(ins.x)) },
  vec: { in: ['x', 'y', 'z'], out: ['v'], compute: (n, ins) => [_toN(ins.x), _toN(ins.y), _toN(ins.z)] },
  // Sinks.
  out_position: {
    in: ['v'],
    out: [],
    compute: (n, ins) => {
      const obj = _resolveObject(n.params.uuid);
      const v = _toVec3(ins.v);
      if (obj && v) obj.position.set(v[0], v[1], v[2]);
      return null;
    },
  },
  out_rotation: {
    in: ['v'],
    out: [],
    compute: (n, ins) => {
      const obj = _resolveObject(n.params.uuid);
      const v = _toVec3(ins.v);
      if (obj && v) obj.rotation.set(v[0], v[1], v[2]);
      return null;
    },
  },
  out_scale: {
    in: ['v'],
    out: [],
    compute: (n, ins) => {
      const obj = _resolveObject(n.params.uuid);
      const v = _toVec3(ins.v);
      if (obj && v) obj.scale.set(v[0], v[1], v[2]);
      return null;
    },
  },
  out_color: {
    in: ['v'],
    out: [],
    compute: (n, ins) => {
      const obj = _resolveObject(n.params.uuid);
      const v = _toVec3(ins.v);
      if (obj?.material?.color && v) obj.material.color.setRGB(v[0], v[1], v[2]);
      return null;
    },
  },
  out_intensity: {
    in: ['v'],
    out: [],
    compute: (n, ins) => {
      const obj = _resolveObject(n.params.uuid);
      if (obj?.isLight) obj.intensity = _toN(ins.v);
      return null;
    },
  },
  out_studioOp: {
    in: ['v'],
    out: [],
    compute: (n, ins) => {
      const opName = n.params.op;
      if (typeof window[opName] === 'function') {
        try { window[opName](ins.v); } catch (_) {}
      }
      return null;
    },
  },
};

function _toN(x) { if (typeof x === 'number') return x; if (Array.isArray(x)) return x[0] || 0; return 0; }
function _toVec3(x) { if (typeof x === 'number') return [x, x, x]; if (Array.isArray(x)) return [x[0] || 0, x[1] || 0, x[2] || 0]; return null; }
function _resolveObject(uuid) { return window.__archdiscScene?.getObjectByProperty('uuid', uuid); }

export function createGraph() {
  const id = _uid();
  _graphs.set(id, { id, nodes: [], edges: [], cache: new Map(), interval: 0 });
  return { ok: true, id };
}

export function addNode(graphId, kind, params) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  if (!NODE_DEFS[kind]) return { ok: false, error: 'unknown kind' };
  const uuid = _uid();
  g.nodes.push({ uuid, kind, params: params || {} });
  return { ok: true, uuid };
}

export function connect(graphId, fromUuid, fromOut, toUuid, toIn) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  g.edges = g.edges.filter((e) => !(e.toUuid === toUuid && e.toIn === toIn));
  g.edges.push({ fromUuid, fromOut: fromOut || 'v', toUuid, toIn });
  return { ok: true };
}

export function setParam(graphId, uuid, key, value) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  const n = g.nodes.find((x) => x.uuid === uuid);
  if (!n) return { ok: false };
  n.params[key] = value;
  return { ok: true };
}

export function removeNode(graphId, uuid) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  g.nodes = g.nodes.filter((n) => n.uuid !== uuid);
  g.edges = g.edges.filter((e) => e.fromUuid !== uuid && e.toUuid !== uuid);
  return { ok: true };
}

function _evaluate(g) {
  g.cache.clear();
  const visiting = new Set();
  function _val(uuid) {
    if (g.cache.has(uuid)) return g.cache.get(uuid);
    if (visiting.has(uuid)) return 0;
    visiting.add(uuid);
    const node = g.nodes.find((n) => n.uuid === uuid);
    if (!node) { visiting.delete(uuid); return 0; }
    const def = NODE_DEFS[node.kind];
    const ins = {};
    for (const slot of def.in) {
      const e = g.edges.find((x) => x.toUuid === uuid && x.toIn === slot);
      if (e) ins[slot] = _val(e.fromUuid);
      else ins[slot] = node.params[slot] !== undefined ? node.params[slot] : 0;
    }
    let out;
    try { out = def.compute(node, ins); } catch (_) { out = 0; }
    visiting.delete(uuid);
    g.cache.set(uuid, out);
    return out;
  }
  // Trigger sinks (out_*).
  for (const n of g.nodes) if (n.kind.startsWith('out_')) _val(n.uuid);
}

export function start(graphId, fps) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  if (g.interval) clearInterval(g.interval);
  g.interval = setInterval(() => _evaluate(g), 1000 / (Number(fps) || 30));
  return { ok: true };
}

export function stop(graphId) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  if (g.interval) { clearInterval(g.interval); g.interval = 0; }
  return { ok: true };
}

export function evaluateOnce(graphId) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  _evaluate(g);
  return { ok: true };
}

export function listNodes(graphId) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  return { ok: true, nodes: g.nodes.map((n) => ({ uuid: n.uuid, kind: n.kind, params: n.params })), edges: g.edges.slice() };
}

export function listKinds() {
  return { ok: true, kinds: Object.entries(NODE_DEFS).map(([k, d]) => ({ kind: k, in: d.in, out: d.out })) };
}
