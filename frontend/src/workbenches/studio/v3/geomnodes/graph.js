// ArchDisc Studio V3 — geometry-node graph state + topological evaluator.
//
// The graph stores nodes by uuid and a flat list of wires:
//   { srcId, srcOut, dstId, dstIn }
//
// evaluate() walks backward from the (first) `output` kind node, resolving
// inputs by recursive eval. A per-evaluation cache keyed by node uuid
// ensures a node feeding two consumers is only evaluated once per run.
//
// Multi-output nodes return an object keyed by output name; the consumer
// extracts the wired slot.

import { NODE_KINDS, makeNode } from './nodes.js';

export function createGraph() {
  return {
    nodes: new Map(), // id → node descriptor
    wires: [],        // [{ srcId, srcOut, dstId, dstIn }]
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

export function connect(graph, srcId, srcOut, dstId, dstIn) {
  const src = graph.nodes.get(srcId);
  const dst = graph.nodes.get(dstId);
  if (!src || !dst) return { ok: false, error: 'unknown node' };
  const srcDef = NODE_KINDS[src.kind];
  const dstDef = NODE_KINDS[dst.kind];
  if (!srcDef || !dstDef) return { ok: false, error: 'unknown kind' };
  if (!srcDef.outputs.find((o) => o.name === srcOut)) return { ok: false, error: 'bad srcOut' };
  if (!dstDef.inputs.find((i) => i.name === dstIn))  return { ok: false, error: 'bad dstIn' };
  if (wouldCycle(graph, srcId, dstId)) return { ok: false, error: 'cycle' };
  // Slot is single-input: replace any existing wire targeting (dstId, dstIn).
  graph.wires = graph.wires.filter((w) => !(w.dstId === dstId && w.dstIn === dstIn));
  graph.wires.push({ srcId, srcOut, dstId, dstIn });
  return { ok: true };
}

export function disconnect(graph, srcId, srcOut, dstId, dstIn) {
  const before = graph.wires.length;
  graph.wires = graph.wires.filter((w) =>
    !(w.srcId === srcId && w.srcOut === srcOut && w.dstId === dstId && w.dstIn === dstIn));
  return { ok: graph.wires.length < before, removed: before - graph.wires.length };
}

// Cycle test: would (src → dst) create a path back to src from dst?
function wouldCycle(graph, srcId, dstId) {
  if (srcId === dstId) return true;
  const seen = new Set();
  const stack = [dstId];
  while (stack.length) {
    const id = stack.pop();
    if (id === srcId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const w of graph.wires) if (w.srcId === id) stack.push(w.dstId);
  }
  return false;
}

// Evaluate a single node, returning whatever its eval() produces.
function evalNode(graph, node, ctx, cache, stack) {
  if (cache.has(node.id)) return cache.get(node.id);
  if (stack.has(node.id)) return null; // defensive — wouldCycle prevents this
  stack.add(node.id);
  const def = NODE_KINDS[node.kind];
  const ins = new Map();
  for (const inSlot of def.inputs) {
    const wire = graph.wires.find((w) => w.dstId === node.id && w.dstIn === inSlot.name);
    if (wire) {
      const src = graph.nodes.get(wire.srcId);
      if (!src) continue;
      const upstream = evalNode(graph, src, ctx, cache, stack);
      const srcDef = NODE_KINDS[src.kind];
      if (srcDef.multiOutput && upstream && typeof upstream === 'object' && !Array.isArray(upstream) && !upstream.isBufferGeometry) {
        ins.set(inSlot.name, upstream[wire.srcOut]);
      } else {
        ins.set(inSlot.name, upstream);
      }
    } else if (inSlot.default !== undefined) {
      ins.set(inSlot.name, inSlot.default);
    }
  }
  const value = def.eval.call(node, ctx, ins);
  cache.set(node.id, value);
  stack.delete(node.id);
  return value;
}

// Find the first `output` kind node, or null.
export function findOutput(graph) {
  for (const n of graph.nodes.values()) if (n.kind === 'output') return n;
  return null;
}

// Evaluate from the Output node and return its BufferGeometry result.
// Returns null if there's no Output or if evaluation produced nothing.
export function evaluate(graph) {
  const out = findOutput(graph);
  if (!out) return null;
  const cache = new Map();
  const stack = new Set();
  const ctx = { now: (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now() };
  const v = evalNode(graph, out, ctx, cache, stack);
  return v || null;
}

// JSON shape: { version, nodes:[{id,kind,params,x,y}], wires }
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
      x: +n.x || 0,
      y: +n.y || 0,
    });
  }
  if (Array.isArray(json.wires)) {
    for (const w of json.wires) {
      if (g.nodes.has(w.srcId) && g.nodes.has(w.dstId)) {
        g.wires.push({ srcId: w.srcId, srcOut: w.srcOut, dstId: w.dstId, dstIn: w.dstIn });
      }
    }
  }
  return g;
}
