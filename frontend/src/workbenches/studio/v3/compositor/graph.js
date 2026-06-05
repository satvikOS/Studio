// ArchDisc Studio V3 — compositor graph state + topological evaluator.
//
// The graph stores nodes by uuid and a flat wire list. Unlike the shader
// graph (which loops per-pixel by re-evaluating the whole DAG for each
// of 65k pixels) the compositor evaluates each node ONCE per evaluate()
// call — the whole-buffer transforms are far too expensive to repeat,
// so we walk topologically from Output and cache buffers by node id.
//
// Wire shape: { srcId, srcOut, dstId, dstIn }
//
// evaluate(sourceImageData) → buffer | null
//   • `sourceImageData` is whatever the install layer captured from
//     renderer.domElement (the rendered viewport). It seeds the Image
//     node + acts as the fallback for empty input sockets.
//   • Returns the Output node's buffer, or null if no Output exists.

import { NODE_KINDS, makeNode, blackBuffer } from './nodes.js';

export function createGraph() {
  return {
    nodes: new Map(),
    wires: [],
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
  if (!dstDef.inputs.find((i) => i.name === dstIn)) return { ok: false, error: 'bad dstIn' };
  if (wouldCycle(graph, srcId, dstId)) return { ok: false, error: 'cycle' };
  // Replace any wire targeting (dstId, dstIn) — slot is single-input.
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

export function findOutput(graph) {
  for (const n of graph.nodes.values()) if (n.kind === 'output') return n;
  return null;
}

function evalNode(graph, node, ctx, cache, stack) {
  if (cache.has(node.id)) return cache.get(node.id);
  if (stack.has(node.id)) return null; // wouldCycle prevents real cycles
  stack.add(node.id);
  const def = NODE_KINDS[node.kind];
  const ins = new Map();
  for (const slot of def.inputs) {
    const wire = graph.wires.find((w) => w.dstId === node.id && w.dstIn === slot.name);
    if (!wire) continue;
    const src = graph.nodes.get(wire.srcId);
    if (!src) continue;
    const upstream = evalNode(graph, src, ctx, cache, stack);
    ins.set(slot.name, upstream);
  }
  const value = def.eval.call(node, ctx, ins);
  cache.set(node.id, value);
  stack.delete(node.id);
  return value;
}

// Topologically walk back from Output; return the Output buffer.
// `sourceImageData` is the renderer frame the Image node draws from.
export function evaluate(graph, sourceImageData) {
  const out = findOutput(graph);
  if (!out) return null;
  const ctx = { source: sourceImageData || null };
  const cache = new Map();
  const stack = new Set();
  const v = evalNode(graph, out, ctx, cache, stack);
  if (v && v.data) return v;
  // Output had no input wired and no source — emit black.
  const w = sourceImageData ? sourceImageData.width : 256;
  const h = sourceImageData ? sourceImageData.height : 256;
  return blackBuffer(w, h);
}

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
