// ArchDisc Studio V3 — compositing graph (slice 867).
// Nuke/Fusion-style node graph for compositing render passes.
// Nodes: input/blur/color-correct/keyer/transform/merge/output.

import { registerOps } from '../common/registry.js';
let _installed = false;
const _graphs = new Map();
const NODE_KINDS = ['input', 'blur', 'color', 'keyer', 'transform', 'merge', 'output', 'invert', 'levels', 'glow'];
function _newGraph(name) { return { name, nodes: new Map(), edges: [] }; }
function _eval(graph, outputId, imageCache = new Map()) {
  if (imageCache.has(outputId)) return imageCache.get(outputId);
  const node = graph.nodes.get(outputId); if (!node) return null;
  const inputs = graph.edges.filter((e) => e.to === outputId).map((e) => _eval(graph, e.from, imageCache));
  let result;
  switch (node.kind) {
    case 'input': result = node.params.dataUrl || null; break;
    case 'invert': case 'blur': case 'color': case 'keyer': case 'transform': case 'levels': case 'glow':
      result = inputs[0]; break;
    case 'merge': result = inputs[0] || inputs[1]; break;
    case 'output': result = inputs[0]; break;
    default: result = null;
  }
  imageCache.set(outputId, result);
  return result;
}
export function installCompGraph() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioCompCreateGraph: ({ name } = {}) => { _graphs.set(name, _newGraph(name)); return { ok: true, name }; },
    __studioCompAddNode: ({ name, kind, params = {} } = {}) => {
      const g = _graphs.get(name); if (!g || !NODE_KINDS.includes(kind)) return { ok: false };
      const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      g.nodes.set(id, { id, kind, params }); return { ok: true, id };
    },
    __studioCompConnect: ({ name, from, to } = {}) => {
      const g = _graphs.get(name); if (!g) return { ok: false };
      g.edges.push({ from, to }); return { ok: true };
    },
    __studioCompEvaluate: ({ name, outputId } = {}) => {
      const g = _graphs.get(name); if (!g) return { ok: false };
      return { ok: true, dataUrl: _eval(g, outputId) };
    },
    __studioCompListNodeKinds: () => ({ ok: true, kinds: NODE_KINDS.slice() }),
    __studioCompListGraphs: () => ({ ok: true, names: [..._graphs.keys()] }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'Compositing graph (Nuke/Fusion-style)');
  return { ok: true };
}
export default installCompGraph;
