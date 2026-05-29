/*
 * Studio Behaviour Tree (Unreal Behavior Tree + Blackboard / Unity Behavior
 * Designer). A tree on the shared node-graph engine: a Root feeds Composite
 * nodes (Sequence / Selector) which order their children left-to-right (by x),
 * down to leaves (Condition / Action). Ticking returns SUCCESS / FAILURE and
 * runs actions against a blackboard + the live scene agent — e.g. "move toward
 * the target, and once reached, signal arrival". Deterministic.
 */

const dist = (ctx) => {
  const a = ctx.agent; if (!a) return Infinity;
  return Math.hypot(ctx.target[0] - a.position.x, ctx.target[1] - a.position.y, ctx.target[2] - a.position.z);
};

const BT_CONDITIONS = {
  reachedTarget: (ctx) => dist(ctx) < ctx.threshold,
  farFromTarget: (ctx) => dist(ctx) >= ctx.threshold,
};

const BT_ACTIONS = {
  moveToward: (ctx) => {
    const a = ctx.agent; if (!a) return 'FAILURE';
    const dx = ctx.target[0] - a.position.x, dy = ctx.target[1] - a.position.y, dz = ctx.target[2] - a.position.z;
    const d = Math.hypot(dx, dy, dz) || 1; const s = Math.min(ctx.step, d);
    a.position.x += dx / d * s; a.position.y += dy / d * s; a.position.z += dz / d * s;
    ctx.log.push('moveToward'); return 'SUCCESS';
  },
  arrive: (ctx) => {
    const a = ctx.agent; if (a && a.material && a.material.color) { a.material.color.set('#3ad07a'); a.material.needsUpdate = true; }
    ctx.log.push('arrive'); return 'SUCCESS';
  },
  idle: (ctx) => { ctx.log.push('idle'); return 'SUCCESS'; },
  retreat: (ctx) => { const a = ctx.agent; if (a) a.position.x -= ctx.step; ctx.log.push('retreat'); return 'SUCCESS'; },
};

export const BT_NODE_TYPES = {
  root: { label: 'Root', inputs: [], outputs: ['out'], params: [] },
  sequence: { label: 'Sequence', inputs: ['in'], outputs: ['out'], params: [] },
  selector: { label: 'Selector', inputs: ['in'], outputs: ['out'], params: [] },
  condition: { label: 'Condition', inputs: ['in'], outputs: [], params: [{ key: 'check', type: 'enum', options: ['reachedTarget', 'farFromTarget'], default: 'reachedTarget' }] },
  action: { label: 'Action', inputs: ['in'], outputs: [], params: [{ key: 'act', type: 'enum', options: ['moveToward', 'arrive', 'idle', 'retreat'], default: 'moveToward' }] },
};

let _btid = 1;
export function behaviorTreeSeed() {
  const root = { id: `root${_btid++}`, type: 'root', x: 30, y: 200, params: {} };
  const sel = { id: `selector${_btid++}`, type: 'selector', x: 170, y: 200, params: {} };
  const seq = { id: `sequence${_btid++}`, type: 'sequence', x: 330, y: 110, params: {} };
  const cond = { id: `condition${_btid++}`, type: 'condition', x: 500, y: 50, params: { check: 'reachedTarget' } };
  const arrive = { id: `action${_btid++}`, type: 'action', x: 510, y: 170, params: { act: 'arrive' } };
  const move = { id: `action${_btid++}`, type: 'action', x: 350, y: 320, params: { act: 'moveToward' } };
  return {
    nodes: [root, sel, seq, cond, arrive, move],
    edges: [
      { from: { node: root.id, port: 'out' }, to: { node: sel.id, port: 'in' } },
      { from: { node: sel.id, port: 'out' }, to: { node: seq.id, port: 'in' } },
      { from: { node: sel.id, port: 'out' }, to: { node: move.id, port: 'in' } },
      { from: { node: seq.id, port: 'out' }, to: { node: cond.id, port: 'in' } },
      { from: { node: seq.id, port: 'out' }, to: { node: arrive.id, port: 'in' } },
    ],
  };
}

// Tick the tree once from the Root, returning the status + the action log.
export function tickBehaviorTree(graph, ctx) {
  const nodes = new Map((graph.nodes || []).map((n) => [n.id, n]));
  const edges = graph.edges || [];
  const root = [...nodes.values()].find((n) => n.type === 'root');
  if (!root) return { status: 'FAILURE', error: 'no Root node' };
  ctx.log = ctx.log || [];
  const childrenOf = (id) => edges.filter((e) => e.from.node === id && e.from.port === 'out')
    .map((e) => nodes.get(e.to.node)).filter(Boolean).sort((a, b) => (a.x || 0) - (b.x || 0));
  function tick(node) {
    if (!node) return 'FAILURE';
    switch (node.type) {
      case 'root': { const c = childrenOf(node.id); return c[0] ? tick(c[0]) : 'FAILURE'; }
      case 'sequence': { for (const c of childrenOf(node.id)) { const st = tick(c); if (st !== 'SUCCESS') return st; } return 'SUCCESS'; }
      case 'selector': { for (const c of childrenOf(node.id)) { const st = tick(c); if (st === 'SUCCESS') return 'SUCCESS'; } return 'FAILURE'; }
      case 'condition': { const fn = BT_CONDITIONS[node.params.check]; return fn && fn(ctx) ? 'SUCCESS' : 'FAILURE'; }
      case 'action': { const fn = BT_ACTIONS[node.params.act]; return fn ? fn(ctx) : 'FAILURE'; }
      default: return 'FAILURE';
    }
  }
  const status = tick(root);
  return { status, log: ctx.log.slice() };
}
