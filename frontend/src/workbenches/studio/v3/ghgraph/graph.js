// Slice 700 — Grasshopper-style visual graph: parametric workflow
// where each node is a callable (any registered Studio op or arithmetic),
// outputs cascade into the next node's inputs. Executes top-to-bottom on
// every input change.

const _nodes = new Map();   // uuid → { uuid, kind, params, inputs:{[name]:srcUuid.slot}, outputs:[] }
let _seq = 1;
function _uuid() { return `gh-${_seq++}-${Date.now().toString(36)}`; }

const _KINDS = {
  number: { eval: (params) => Number(params.value) || 0 },
  vector3: { eval: (params) => [Number(params.x) || 0, Number(params.y) || 0, Number(params.z) || 0] },
  string: { eval: (params) => String(params.value || '') },
  add: { eval: (params, inputs) => (Number(inputs.a) || 0) + (Number(inputs.b) || 0) },
  sub: { eval: (params, inputs) => (Number(inputs.a) || 0) - (Number(inputs.b) || 0) },
  mul: { eval: (params, inputs) => (Number(inputs.a) || 0) * (Number(inputs.b) || 0) },
  div: { eval: (params, inputs) => (Number(inputs.b) || 1) === 0 ? 0 : (Number(inputs.a) || 0) / Number(inputs.b) },
  range: { eval: (params, inputs) => {
    const lo = Number(inputs.lo ?? params.lo) || 0;
    const hi = Number(inputs.hi ?? params.hi) || 1;
    const count = Math.max(2, Math.floor(Number(inputs.count ?? params.count) || 10));
    const out = [];
    for (let i = 0; i < count; i++) out.push(lo + (hi - lo) * (i / (count - 1)));
    return out;
  }},
  studioOp: { eval: (params, inputs) => {
    // params.opName + inputs flow into args.
    const fn = window[params.opName];
    if (typeof fn !== 'function') return { ok: false, error: 'no such op' };
    const args = Object.keys(inputs).sort().map((k) => inputs[k]);
    try { return fn(...args); } catch (e) { return { ok: false, error: e.message }; }
  }},
};

export function addNode(kind, params) {
  if (!_KINDS[kind]) return { ok: false, error: 'unknown kind' };
  const uuid = _uuid();
  _nodes.set(uuid, { uuid, kind, params: params || {}, inputs: {}, cachedOutput: null });
  return { ok: true, uuid, kind };
}

export function setParam(uuid, name, value) {
  const n = _nodes.get(uuid);
  if (!n) return { ok: false };
  n.params[name] = value;
  return { ok: true };
}

export function connect(srcUuid, dstUuid, dstInput) {
  const dst = _nodes.get(dstUuid);
  if (!dst || !_nodes.has(srcUuid)) return { ok: false };
  dst.inputs[dstInput] = srcUuid;
  return { ok: true };
}

export function disconnect(dstUuid, dstInput) {
  const dst = _nodes.get(dstUuid);
  if (!dst) return { ok: false };
  delete dst.inputs[dstInput];
  return { ok: true };
}

export function removeNode(uuid) {
  if (!_nodes.has(uuid)) return { ok: false };
  _nodes.delete(uuid);
  // Clean up dangling input references.
  for (const n of _nodes.values()) {
    for (const k of Object.keys(n.inputs)) {
      if (n.inputs[k] === uuid) delete n.inputs[k];
    }
  }
  return { ok: true };
}

function _evalNode(uuid, cache, visiting) {
  if (cache.has(uuid)) return cache.get(uuid);
  if (visiting.has(uuid)) return null; // cycle guard
  visiting.add(uuid);
  const n = _nodes.get(uuid);
  if (!n) return null;
  const resolvedInputs = {};
  for (const [k, srcUuid] of Object.entries(n.inputs)) {
    resolvedInputs[k] = _evalNode(srcUuid, cache, visiting);
  }
  const result = _KINDS[n.kind].eval(n.params, resolvedInputs);
  cache.set(uuid, result);
  n.cachedOutput = result;
  visiting.delete(uuid);
  return result;
}

export function evaluate() {
  const cache = new Map();
  const visiting = new Set();
  // Identify terminal nodes (no other node consumes them) — those drive eval.
  const consumed = new Set();
  for (const n of _nodes.values()) {
    for (const src of Object.values(n.inputs)) consumed.add(src);
  }
  const terminals = Array.from(_nodes.values()).filter((n) => !consumed.has(n.uuid));
  const results = terminals.map((n) => ({ uuid: n.uuid, kind: n.kind, output: _evalNode(n.uuid, cache, visiting) }));
  return { ok: true, terminalResults: results, totalNodes: _nodes.size };
}

export function listNodes() {
  return Array.from(_nodes.values()).map((n) => ({
    uuid: n.uuid, kind: n.kind, params: { ...n.params }, inputs: { ...n.inputs },
    hasOutput: n.cachedOutput != null,
  }));
}

export function getNodeOutput(uuid) {
  const n = _nodes.get(uuid);
  return n ? { ok: true, output: n.cachedOutput } : { ok: false };
}

export function listKinds() {
  return Object.keys(_KINDS);
}

export function exportJson() {
  const arr = Array.from(_nodes.values()).map((n) => ({
    uuid: n.uuid, kind: n.kind, params: n.params, inputs: n.inputs,
  }));
  return JSON.stringify(arr);
}

export function importJson(json) {
  try {
    const arr = JSON.parse(json);
    _nodes.clear();
    for (const n of arr) {
      _nodes.set(n.uuid, { uuid: n.uuid, kind: n.kind, params: n.params || {}, inputs: n.inputs || {}, cachedOutput: null });
    }
    return { ok: true, count: _nodes.size };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

export function clearGraph() {
  _nodes.clear();
  return { ok: true };
}
