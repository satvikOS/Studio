// Slice 705 — Houdini VOPs (visual VEX). A directed-acyclic node graph
// where nodes are typed VEX operators (constant / param / add / mul /
// noise / dot / cross / lerp / fit / vector / sin / sqrt / floor) and
// edges carry scalar or vec3 values. compile() emits VEX source that
// runOnPoints (slice-686 vex) can execute per-point.

const _graphs = new Map();
let _seq = 1;
function _uid() { return `vops-${_seq++}-${Date.now().toString(36)}`; }

const NODE_DEFS = {
  // [inSlots, outSlots, vexFn]
  const_f: { in: [], out: ['v'], emit: (n) => `${Number(n.params.value) || 0}` },
  const_v: { in: [], out: ['v'], emit: (n) => `vector(${(n.params.x) || 0}, ${(n.params.y) || 0}, ${(n.params.z) || 0})` },
  param_P: { in: [], out: ['v'], emit: () => `@P` },
  param_N: { in: [], out: ['v'], emit: () => `@N` },
  param_Cd: { in: [], out: ['v'], emit: () => `@Cd` },
  param_ptnum: { in: [], out: ['v'], emit: () => `@ptnum` },
  add: { in: ['a', 'b'], out: ['v'], emit: (n, ins) => `(${ins.a} + ${ins.b})` },
  sub: { in: ['a', 'b'], out: ['v'], emit: (n, ins) => `(${ins.a} - ${ins.b})` },
  mul: { in: ['a', 'b'], out: ['v'], emit: (n, ins) => `(${ins.a} * ${ins.b})` },
  div: { in: ['a', 'b'], out: ['v'], emit: (n, ins) => `(${ins.a} / ${ins.b})` },
  noise: { in: ['x', 'y', 'z'], out: ['v'], emit: (n, ins) => `noise(${ins.x}, ${ins.y}, ${ins.z})` },
  sin: { in: ['x'], out: ['v'], emit: (n, ins) => `sin(${ins.x})` },
  cos: { in: ['x'], out: ['v'], emit: (n, ins) => `cos(${ins.x})` },
  sqrt: { in: ['x'], out: ['v'], emit: (n, ins) => `sqrt(${ins.x})` },
  floor: { in: ['x'], out: ['v'], emit: (n, ins) => `floor(${ins.x})` },
  dot: { in: ['a', 'b'], out: ['v'], emit: (n, ins) => `dot(${ins.a}, ${ins.b})` },
  cross: { in: ['a', 'b'], out: ['v'], emit: (n, ins) => `cross(${ins.a}, ${ins.b})` },
  length: { in: ['v'], out: ['v'], emit: (n, ins) => `length(${ins.v})` },
  normalize: { in: ['v'], out: ['v'], emit: (n, ins) => `normalize(${ins.v})` },
  lerp: { in: ['a', 'b', 't'], out: ['v'], emit: (n, ins) => `lerp(${ins.a}, ${ins.b}, ${ins.t})` },
  fit: { in: ['v', 'oMin', 'oMax', 'nMin', 'nMax'], out: ['v'], emit: (n, ins) => `fit(${ins.v}, ${ins.oMin}, ${ins.oMax}, ${ins.nMin}, ${ins.nMax})` },
  vector: { in: ['x', 'y', 'z'], out: ['v'], emit: (n, ins) => `vector(${ins.x}, ${ins.y}, ${ins.z})` },
  out_P: { in: ['v'], out: [], emit: (n, ins) => `@P = ${ins.v}` },
  out_N: { in: ['v'], out: [], emit: (n, ins) => `@N = ${ins.v}` },
  out_Cd: { in: ['v'], out: [], emit: (n, ins) => `@Cd = ${ins.v}` },
};

export function createGraph() {
  const id = _uid();
  _graphs.set(id, { id, nodes: [], edges: [] });
  return { ok: true, id };
}

export function addNode(graphId, kind, params) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  if (!NODE_DEFS[kind]) return { ok: false, error: 'unknown node kind: ' + kind };
  const node = { uuid: _uid(), kind, params: params || {} };
  g.nodes.push(node);
  return { ok: true, uuid: node.uuid };
}

export function connect(graphId, fromUuid, fromOutSlot, toUuid, toInSlot) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  // Disconnect existing edges to the same (toUuid, toInSlot).
  g.edges = g.edges.filter((e) => !(e.toUuid === toUuid && e.toInSlot === toInSlot));
  g.edges.push({ fromUuid, fromOutSlot: fromOutSlot || 'v', toUuid, toInSlot });
  return { ok: true };
}

export function removeNode(graphId, uuid) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  g.nodes = g.nodes.filter((n) => n.uuid !== uuid);
  g.edges = g.edges.filter((e) => e.fromUuid !== uuid && e.toUuid !== uuid);
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

export function compile(graphId) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  const exprCache = new Map();
  const visiting = new Set();
  function _exprFor(uuid) {
    if (exprCache.has(uuid)) return exprCache.get(uuid);
    if (visiting.has(uuid)) return '0';
    visiting.add(uuid);
    const node = g.nodes.find((n) => n.uuid === uuid);
    if (!node) { visiting.delete(uuid); return '0'; }
    const def = NODE_DEFS[node.kind];
    if (!def) { visiting.delete(uuid); return '0'; }
    const ins = {};
    for (const slot of def.in) {
      const e = g.edges.find((x) => x.toUuid === uuid && x.toInSlot === slot);
      if (!e) {
        const pv = node.params[slot];
        ins[slot] = pv !== undefined ? `(${pv})` : '0';
      } else {
        ins[slot] = _exprFor(e.fromUuid);
      }
    }
    let expr;
    try { expr = def.emit(node, ins); } catch (_) { expr = '0'; }
    exprCache.set(uuid, expr);
    visiting.delete(uuid);
    return expr;
  }
  // Emit statements for all out_* nodes.
  const stmts = [];
  for (const n of g.nodes) {
    if (n.kind.startsWith('out_')) {
      stmts.push(_exprFor(n.uuid) + ';');
    }
  }
  return { ok: true, vex: stmts.join('\n') };
}

export function compileAndRun(graphId, meshUuid) {
  const c = compile(graphId);
  if (!c.ok) return { ok: false };
  if (typeof window.__studioVexRunOnPoints === 'function') {
    return window.__studioVexRunOnPoints(meshUuid, c.vex);
  }
  return { ok: false, error: 'VEX runtime not installed' };
}

export function listNodes(graphId) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  return {
    ok: true,
    nodes: g.nodes.map((n) => ({ uuid: n.uuid, kind: n.kind, params: n.params })),
    edges: g.edges.slice(),
  };
}

export function listKinds() {
  return { ok: true, kinds: Object.keys(NODE_DEFS).map((k) => ({ kind: k, in: NODE_DEFS[k].in, out: NODE_DEFS[k].out })) };
}
