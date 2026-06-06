// Slice 723 — Substance Designer Function Graph. Sub-graphs that
// expose typed parameters (float / int / vec3 / bool) and compute a
// single output via a tiny expression tree of math operations. A
// function can be invoked from a slice-716 substancegraph node to
// drive any node parameter procedurally.

const _functions = new Map();
let _seq = 1;
function _uid() { return `sf-${_seq++}-${Date.now().toString(36)}`; }

const FUNC_NODE_DEFS = {
  param: (n) => n.params.value,
  number: (n) => Number(n.params.value) || 0,
  add: (n, ins) => Number(ins.a || 0) + Number(ins.b || 0),
  sub: (n, ins) => Number(ins.a || 0) - Number(ins.b || 0),
  mul: (n, ins) => Number(ins.a || 0) * Number(ins.b || 0),
  div: (n, ins) => Number(ins.a || 0) / (Number(ins.b) || 1),
  sin: (n, ins) => Math.sin(Number(ins.x) || 0),
  cos: (n, ins) => Math.cos(Number(ins.x) || 0),
  pow: (n, ins) => Math.pow(Number(ins.a || 0), Number(ins.b || 1)),
  abs: (n, ins) => Math.abs(Number(ins.x) || 0),
  min: (n, ins) => Math.min(Number(ins.a || 0), Number(ins.b || 0)),
  max: (n, ins) => Math.max(Number(ins.a || 0), Number(ins.b || 0)),
  clamp: (n, ins) => Math.max(Number(ins.lo || 0), Math.min(Number(ins.hi || 1), Number(ins.x || 0))),
  lerp: (n, ins) => (Number(ins.a || 0) * (1 - Number(ins.t || 0))) + (Number(ins.b || 0) * Number(ins.t || 0)),
  output: (n, ins) => Number(ins.value || 0),
};

const FUNC_NODE_INS = {
  param: [], number: [],
  add: ['a', 'b'], sub: ['a', 'b'], mul: ['a', 'b'], div: ['a', 'b'],
  sin: ['x'], cos: ['x'], abs: ['x'],
  pow: ['a', 'b'], min: ['a', 'b'], max: ['a', 'b'],
  clamp: ['x', 'lo', 'hi'],
  lerp: ['a', 'b', 't'],
  output: ['value'],
};

export function defineFunction(name, opts) {
  const id = _uid();
  _functions.set(id, {
    id, name,
    nodes: [],
    edges: [],
    params: opts?.params || [],
    output: null,
  });
  return { ok: true, id };
}

export function addNode(funcId, kind, params) {
  const f = _functions.get(funcId);
  if (!f) return { ok: false };
  if (!FUNC_NODE_DEFS[kind]) return { ok: false, error: 'unknown kind' };
  const uuid = _uid();
  f.nodes.push({ uuid, kind, params: params || {} });
  return { ok: true, uuid };
}

export function connect(funcId, fromUuid, toUuid, toIn) {
  const f = _functions.get(funcId);
  if (!f) return { ok: false };
  f.edges = f.edges.filter((e) => !(e.toUuid === toUuid && e.toIn === toIn));
  f.edges.push({ fromUuid, toUuid, toIn });
  return { ok: true };
}

export function evaluate(funcId, paramValues) {
  const f = _functions.get(funcId);
  if (!f) return { ok: false };
  const cache = new Map();
  const visiting = new Set();
  function _val(uuid) {
    if (cache.has(uuid)) return cache.get(uuid);
    if (visiting.has(uuid)) return 0;
    visiting.add(uuid);
    const node = f.nodes.find((n) => n.uuid === uuid);
    if (!node) { visiting.delete(uuid); return 0; }
    if (node.kind === 'param') {
      const v = paramValues?.[node.params.name];
      cache.set(uuid, v !== undefined ? v : 0);
      visiting.delete(uuid);
      return cache.get(uuid);
    }
    const ins = {};
    for (const slot of FUNC_NODE_INS[node.kind] || []) {
      const e = f.edges.find((x) => x.toUuid === uuid && x.toIn === slot);
      if (e) ins[slot] = _val(e.fromUuid);
      else ins[slot] = node.params[slot] !== undefined ? node.params[slot] : 0;
    }
    let v;
    try { v = FUNC_NODE_DEFS[node.kind](node, ins); } catch (_) { v = 0; }
    cache.set(uuid, v);
    visiting.delete(uuid);
    return v;
  }
  // Find output node.
  const output = f.nodes.find((n) => n.kind === 'output');
  if (!output) return { ok: false, error: 'no output node' };
  return { ok: true, value: _val(output.uuid) };
}

export function listFunctions() {
  return {
    ok: true,
    functions: Array.from(_functions.values()).map((f) => ({
      id: f.id, name: f.name, nodeCount: f.nodes.length, edgeCount: f.edges.length,
    })),
  };
}

export function listKinds() {
  return {
    ok: true,
    kinds: Object.entries(FUNC_NODE_DEFS).map(([k, _]) => ({ kind: k, ins: FUNC_NODE_INS[k] })),
  };
}

export function deleteFunction(id) {
  return { ok: _functions.delete(id) };
}
