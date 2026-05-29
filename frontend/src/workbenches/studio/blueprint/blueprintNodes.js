/*
 * Studio Blueprint / Visual Scripting graph (Unreal Blueprint / Unity Visual
 * Scripting / Blender Geometry-Nodes-style logic). Unlike the data-flow geometry
 * & material graphs, this is an EXECUTION-flow graph: an Event node fires and
 * control follows the white "exec" wire from node to node, each node acting on
 * the live scene. Data pins (e.g. a spawned object) flow along separate wires.
 *
 * The executor walks the exec chain from Event BeginPlay, running each node's
 * run(ctx, inputs, params) in order; data inputs resolve to the output a prior
 * exec node produced. ctx is supplied by the workbench (spawn callback, log).
 */

export const BLUEPRINT_NODE_TYPES = {
  eventBeginPlay: {
    label: 'Event BeginPlay',
    inputs: [], outputs: ['exec'], params: [],
    run() { return {}; },
  },
  spawn: {
    label: 'Spawn Primitive',
    inputs: ['exec'], outputs: ['exec', 'object'],
    params: [
      { key: 'kind', type: 'enum', options: ['cube', 'sphere', 'cylinder', 'cone', 'torus', 'icosahedron'], default: 'cube' },
      { key: 'x', type: 'number', default: 0 },
      { key: 'y', type: 'number', default: 0 },
      { key: 'z', type: 'number', default: 0 },
    ],
    run(ctx, _inp, p) {
      const m = ctx.spawn ? ctx.spawn(p.kind || 'cube') : null;
      if (m && m.position) m.position.set(p.x || 0, p.y || 0, p.z || 0);
      ctx.log.push(`spawn ${p.kind || 'cube'}`);
      return { object: m };
    },
  },
  move: {
    label: 'Move',
    inputs: ['exec', 'target'], outputs: ['exec'],
    params: [{ key: 'dx', type: 'number', default: 0.3 }, { key: 'dy', type: 'number', default: 0 }, { key: 'dz', type: 'number', default: 0 }],
    run(ctx, inp, p) {
      const m = inp.target;
      if (m && m.position) { m.position.x += p.dx || 0; m.position.y += p.dy || 0; m.position.z += p.dz || 0; ctx.log.push(`move (${p.dx},${p.dy},${p.dz})`); }
      return {};
    },
  },
  rotate: {
    label: 'Rotate',
    inputs: ['exec', 'target'], outputs: ['exec'],
    params: [{ key: 'rx', type: 'number', default: 0 }, { key: 'ry', type: 'number', default: 0.5 }, { key: 'rz', type: 'number', default: 0 }],
    run(ctx, inp, p) {
      const m = inp.target;
      if (m && m.rotation) { m.rotation.x += p.rx || 0; m.rotation.y += p.ry || 0; m.rotation.z += p.rz || 0; ctx.log.push(`rotate (${p.rx},${p.ry},${p.rz})`); }
      return {};
    },
  },
  scale: {
    label: 'Scale',
    inputs: ['exec', 'target'], outputs: ['exec'],
    params: [{ key: 's', type: 'number', default: 1.5 }],
    run(ctx, inp, p) {
      const m = inp.target; const s = p.s || 1;
      if (m && m.scale) { m.scale.multiplyScalar(s); ctx.log.push(`scale x${s}`); }
      return {};
    },
  },
  setColor: {
    label: 'Set Color',
    inputs: ['exec', 'target'], outputs: ['exec'],
    params: [{ key: 'color', type: 'color', default: '#cc2222' }],
    run(ctx, inp, p) {
      const m = inp.target;
      if (m && m.material && m.material.color) { m.material.color.set(p.color || '#cc2222'); m.material.needsUpdate = true; ctx.log.push(`setColor ${p.color}`); }
      return {};
    },
  },
};

// Seed: Event -> Spawn -> Move -> Set Color.
let _bid = 1;
export function blueprintSeed() {
  const ev = { id: `eventBeginPlay${_bid++}`, type: 'eventBeginPlay', x: 30, y: 70, params: {} };
  const sp = { id: `spawn${_bid++}`, type: 'spawn', x: 220, y: 70, params: { kind: 'cube', x: 0, y: 0, z: 0 } };
  const mv = { id: `move${_bid++}`, type: 'move', x: 430, y: 70, params: { dx: 0.3, dy: 0, dz: 0 } };
  const sc = { id: `setColor${_bid++}`, type: 'setColor', x: 640, y: 70, params: { color: '#cc2222' } };
  return {
    nodes: [ev, sp, mv, sc],
    edges: [
      { from: { node: ev.id, port: 'exec' }, to: { node: sp.id, port: 'exec' } },
      { from: { node: sp.id, port: 'exec' }, to: { node: mv.id, port: 'exec' } },
      { from: { node: sp.id, port: 'object' }, to: { node: mv.id, port: 'target' } },
      { from: { node: mv.id, port: 'exec' }, to: { node: sc.id, port: 'exec' } },
      { from: { node: sp.id, port: 'object' }, to: { node: sc.id, port: 'target' } },
    ],
  };
}

// Execute an exec-flow graph against the scene via ctx.
export function runBlueprint(graph, ctx) {
  const nodes = new Map((graph.nodes || []).map((n) => [n.id, n]));
  const edges = graph.edges || [];
  const ev = [...nodes.values()].find((n) => n.type === 'eventBeginPlay');
  if (!ev) return { error: 'no Event BeginPlay node' };
  ctx.log = ctx.log || [];
  const outputs = {};
  const resolveInput = (nodeId, port) => {
    const e = edges.find((x) => x.to.node === nodeId && x.to.port === port);
    if (!e) return null;
    const src = outputs[e.from.node];
    return src ? src[e.from.port] : null;
  };
  let current = ev, steps = 0; const visited = new Set([ev.id]);
  while (current && steps < 1000) {
    steps++;
    const type = BLUEPRINT_NODE_TYPES[current.type];
    if (type && type.run) {
      const inp = {};
      (type.inputs || []).forEach((p) => { if (p !== 'exec') inp[p] = resolveInput(current.id, p); });
      outputs[current.id] = type.run(ctx, inp, current.params || {}) || {};
    }
    const next = edges.find((e) => e.from.node === current.id && e.from.port === 'exec' && e.to.port === 'exec');
    if (!next || visited.has(next.to.node)) break;
    visited.add(next.to.node);
    current = nodes.get(next.to.node);
  }
  return { ran: steps, log: ctx.log.slice() };
}
