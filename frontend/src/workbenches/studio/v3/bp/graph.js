// ArchDisc Studio V3 — Blueprints graph state.
//
// Stores nodes by uuid and a flat list of wires. A wire's `kind` flags it
// as either an exec wire (control flow) or a data wire (value pull). The
// runtime walks the exec wires forward; the data resolver walks data
// wires backward from any node about to fire.
//
// Connection shape:
//   { kind: 'exec' | 'data', srcId, srcOut, dstId, dstIn }
//
// Slot-uniqueness rules
//   • Data inputs are single-source (replace).
//   • Exec inputs are single-source too (replace).
//   • Exec outputs are also single-target (a `then` pin only fires the
//     one node it's wired to — matches UE Blueprints).
//   • Data outputs CAN fan out to many consumers.

import { NODE_KINDS, makeNode, isExecSlot } from './nodes.js';

export function createGraph() {
  return {
    nodes: new Map(),   // id → node
    wires: [],          // [{ kind, srcId, srcOut, dstId, dstIn }]
  };
}

export function addNode(graph, kind, params) {
  const node = makeNode(kind, params);
  graph.nodes.set(node.id, node);
  return node;
}

export function removeNode(graph, id) {
  const had = graph.nodes.delete(id);
  graph.wires = graph.wires.filter((w) => w.srcId !== id && w.dstId !== id);
  return had;
}

function slotByName(slots, name) {
  return slots.find((s) => s.name === name) || null;
}

function _validateAndConnect(graph, kind, srcId, srcOut, dstId, dstIn) {
  const src = graph.nodes.get(srcId);
  const dst = graph.nodes.get(dstId);
  if (!src || !dst) return { ok: false, error: 'unknown node' };
  const sdef = NODE_KINDS[src.kind];
  const ddef = NODE_KINDS[dst.kind];
  if (!sdef || !ddef) return { ok: false, error: 'unknown kind' };
  const outSlot = slotByName(sdef.outputs, srcOut);
  const inSlot = slotByName(ddef.inputs, dstIn);
  if (!outSlot) return { ok: false, error: 'bad srcOut' };
  if (!inSlot)  return { ok: false, error: 'bad dstIn' };
  const outIsExec = isExecSlot(outSlot);
  const inIsExec  = isExecSlot(inSlot);
  if (kind === 'exec' && !(outIsExec && inIsExec)) {
    return { ok: false, error: 'exec wire requires exec slots on both ends' };
  }
  if (kind === 'data' && (outIsExec || inIsExec)) {
    return { ok: false, error: 'data wire cannot touch an exec slot' };
  }
  // Cycle prevention: only data wires need it (exec graphs can loop
  // through delays + events; but disallow direct exec→self at minimum).
  if (kind === 'data' && wouldDataCycle(graph, srcId, dstId)) {
    return { ok: false, error: 'data cycle' };
  }
  if (kind === 'exec' && srcId === dstId) {
    return { ok: false, error: 'self exec wire' };
  }
  // Replace destination input (always single-source).
  graph.wires = graph.wires.filter((w) =>
    !(w.kind === kind && w.dstId === dstId && w.dstIn === dstIn));
  // Exec outputs are also single-target — clear competing source pin.
  if (kind === 'exec') {
    graph.wires = graph.wires.filter((w) =>
      !(w.kind === 'exec' && w.srcId === srcId && w.srcOut === srcOut));
  }
  graph.wires.push({ kind, srcId, srcOut, dstId, dstIn });
  return { ok: true };
}

export function connectExec(graph, srcId, srcOut, dstId, dstIn) {
  return _validateAndConnect(graph, 'exec', srcId, srcOut, dstId, dstIn);
}
export function connectData(graph, srcId, srcOut, dstId, dstIn) {
  return _validateAndConnect(graph, 'data', srcId, srcOut, dstId, dstIn);
}

export function disconnect(graph, srcId, srcOut, dstId, dstIn) {
  const before = graph.wires.length;
  graph.wires = graph.wires.filter((w) =>
    !(w.srcId === srcId && w.srcOut === srcOut && w.dstId === dstId && w.dstIn === dstIn));
  return { ok: graph.wires.length < before, removed: before - graph.wires.length };
}

// Test if adding a data wire src→dst would create a cycle in the data DAG.
function wouldDataCycle(graph, srcId, dstId) {
  if (srcId === dstId) return true;
  const seen = new Set();
  const stack = [srcId];
  while (stack.length) {
    const id = stack.pop();
    if (id === dstId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const w of graph.wires) {
      if (w.kind === 'data' && w.dstId === id) stack.push(w.srcId);
    }
  }
  return false;
}

// Resolve every data input for a node by walking backward through data
// wires. Pure-data nodes that produce many outputs cache their map per
// resolution pass.
//
// IMPORTANT: `ins` only contains entries for slots that have a wire
// connected (or whose source published a value into `cache`). Nodes
// should consult `this.params[name]` as their per-instance default and
// treat `ins.get(name)` as an override. This lets the editor's
// per-instance param values stay authoritative when nothing's wired.
export function resolveInputs(graph, node, ctx, cache) {
  const def = NODE_KINDS[node.kind];
  const ins = new Map();
  if (!def) return ins;
  for (const slot of def.inputs) {
    if (isExecSlot(slot)) continue;
    const wire = graph.wires.find((w) =>
      w.kind === 'data' && w.dstId === node.id && w.dstIn === slot.name);
    if (!wire) continue;
    const src = graph.nodes.get(wire.srcId);
    if (!src) continue;
    const value = _evalDataNode(graph, src, ctx, cache);
    if (value && typeof value === 'object' && !Array.isArray(value) &&
        NODE_KINDS[src.kind] && NODE_KINDS[src.kind].outputs &&
        NODE_KINDS[src.kind].outputs.length > 1) {
      ins.set(slot.name, value[wire.srcOut]);
    } else if (value && typeof value === 'object' && !Array.isArray(value) &&
               Object.prototype.hasOwnProperty.call(value, wire.srcOut)) {
      ins.set(slot.name, value[wire.srcOut]);
    } else {
      ins.set(slot.name, value);
    }
  }
  return ins;
}

// Evaluate a data-only node (Number/Vector3/Get/Math) — caches per pass.
// For event/action nodes used as data sources (e.g. CallStudioOp.result
// passed forward via runtime cache), the runtime supplies the value
// through `cache` keyed by node.id directly.
function _evalDataNode(graph, node, ctx, cache) {
  if (cache.has(node.id)) return cache.get(node.id);
  const def = NODE_KINDS[node.kind];
  if (!def) { cache.set(node.id, undefined); return undefined; }
  // Pure data nodes: resolve inputs + call evalData.
  if (typeof def.evalData === 'function') {
    const subIns = resolveInputs(graph, node, ctx, cache);
    let v;
    try { v = def.evalData.call(node, ctx, subIns); }
    catch (_) { v = undefined; }
    // Single-output shortcut: lift raw value under output[0].name.
    if (def.outputs.length === 1 && (v === undefined || typeof v !== 'object' || Array.isArray(v))) {
      v = { [def.outputs[0].name]: v };
    }
    cache.set(node.id, v);
    return v;
  }
  // Event/action node used as data source: only data the runtime has
  // already published (via ctx cache) is visible. If nothing's there yet
  // return undefined — slot will fall to default.
  return undefined;
}

// Serialise to plain JSON.
export function toJSON(graph) {
  return {
    version: 1,
    nodes: Array.from(graph.nodes.values()).map((n) => ({
      id: n.id, kind: n.kind, params: n.params, x: n.x, y: n.y,
    })),
    wires: graph.wires.slice(),
  };
}

export function fromJSON(json) {
  const g = createGraph();
  if (!json || !Array.isArray(json.nodes)) return g;
  for (const n of json.nodes) {
    const def = NODE_KINDS[n.kind];
    if (!def) continue;
    g.nodes.set(n.id, {
      id: n.id,
      kind: n.kind,
      title: def.title,
      params: { ...def.defaultParams(), ...(n.params || {}) },
      x: Number(n.x) || 0,
      y: Number(n.y) || 0,
    });
  }
  if (Array.isArray(json.wires)) {
    for (const w of json.wires) {
      if (!g.nodes.has(w.srcId) || !g.nodes.has(w.dstId)) continue;
      const kind = (w.kind === 'exec' || w.kind === 'data') ? w.kind : 'data';
      g.wires.push({ kind, srcId: w.srcId, srcOut: w.srcOut, dstId: w.dstId, dstIn: w.dstIn });
    }
  }
  return g;
}

// Find the exec wire leaving (srcId, srcOut). Single-target by construction.
export function findExecTarget(graph, srcId, srcOut) {
  return graph.wires.find((w) => w.kind === 'exec' && w.srcId === srcId && w.srcOut === srcOut) || null;
}

// All event-kind nodes currently in the graph.
export function listEventNodes(graph) {
  const out = [];
  for (const n of graph.nodes.values()) {
    const def = NODE_KINDS[n.kind];
    if (def && def.event) out.push(n);
  }
  return out;
}
