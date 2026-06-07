// ArchDisc Studio V3 — compositing graph (slice 867 + slice 889 depth push).
//
// Nuke/Fusion-style node graph for compositing render passes. The original
// slice-867 evaluator was a structural stub: every non-input node returned
// `inputs[0]` unchanged. Slice 889 replaces that with REAL per-pixel image
// processing — all per-node algorithms live in `./imageOps.js` and operate
// on raw RGBA ImageData buffers (Gaussian convolution, chroma key, levels,
// curves, bilinear transform, Porter-Duff merge, glow, etc).
//
// Node kinds (all backed by real pixel math):
//   input       — load image from dataUrl / url into ImageData
//   blur        — separable 3-pass Gaussian
//   color       — per-channel input/output remap + gamma
//   keyer       — chroma key matte + despill
//   transform   — translate / rotate / scale with bilinear sampling
//   merge       — over / under / screen / multiply / add blend modes
//   invert      — 255 - channel
//   levels      — input black/white + gamma midpoint + output range
//   glow        — bright pass + Gaussian + screen blend
//   output      — converts the final ImageData back to a PNG dataUrl
//
// `__studioCompEvaluate` is now async — pixel work touches images that load
// asynchronously and per-frame convolutions can take meaningful time. Each
// call returns `{ ok, dataUrl, width, height }` where `dataUrl` is the
// composited PNG ready to drop into an <img> or download.

import { registerOps } from '../common/registry.js';
import {
  loadImage, imageToImageData, imageDataToDataUrl, cloneImageData, emptyImageData,
  invert, colorGrade, levels, gaussianBlur, chromaKey, transform, merge, glow,
} from './imageOps.js';

let _installed = false;
const _graphs = new Map();
const NODE_KINDS = ['input', 'blur', 'color', 'keyer', 'transform', 'merge', 'output', 'invert', 'levels', 'glow'];

function _newGraph(name) { return { name, nodes: new Map(), edges: [] }; }

// Resolve a single input node into its rendered ImageData. Results are
// memoised in `cache` so a diamond-shaped DAG only evaluates each branch
// once per `__studioCompEvaluate` call.
async function _evalNode(graph, nodeId, cache) {
  if (cache.has(nodeId)) return cache.get(nodeId);
  const node = graph.nodes.get(nodeId);
  if (!node) { cache.set(nodeId, null); return null; }

  // Pull every upstream feeder. Multi-input nodes (merge) get all of them.
  const inEdges = graph.edges.filter((e) => e.to === nodeId);
  const inputs = [];
  for (const e of inEdges) inputs.push(await _evalNode(graph, e.from, cache));

  const p = node.params || {};
  let result = null;

  try {
    switch (node.kind) {
      case 'input': {
        // Either inline dataUrl, an external url, or a preloaded ImageData.
        if (p.imageData && p.imageData.data && p.imageData.width) {
          result = p.imageData;
        } else if (p.dataUrl || p.url) {
          const img = await loadImage(p.dataUrl || p.url);
          result = imageToImageData(img, p.width, p.height);
        } else if (p.width && p.height) {
          // Solid colour fill — handy for procedural test patterns.
          const id = emptyImageData(p.width, p.height);
          const fill = p.fill || [0, 0, 0, 0];
          const d = id.data;
          for (let i = 0; i < d.length; i += 4) {
            d[i] = fill[0]; d[i + 1] = fill[1]; d[i + 2] = fill[2]; d[i + 3] = fill[3];
          }
          result = id;
        }
        break;
      }
      case 'invert':
        result = inputs[0] ? invert(inputs[0]) : null; break;
      case 'blur':
        result = inputs[0] ? gaussianBlur(inputs[0], p.radius ?? 4, p.sigma ?? 0) : null; break;
      case 'color':
        result = inputs[0] ? colorGrade(inputs[0], p) : null; break;
      case 'keyer':
        result = inputs[0] ? chromaKey(inputs[0], p) : null; break;
      case 'transform':
        result = inputs[0] ? transform(inputs[0], p) : null; break;
      case 'levels':
        result = inputs[0] ? levels(inputs[0], p) : null; break;
      case 'glow':
        result = inputs[0] ? glow(inputs[0], p) : null; break;
      case 'merge': {
        const top = inputs[0] || null;
        const bottom = inputs[1] || null;
        result = merge(top, bottom, p.mode || 'over');
        break;
      }
      case 'output':
        // Output is a pass-through ImageData — the dataUrl conversion happens
        // at the evaluate boundary so intermediate outputs stay editable.
        result = inputs[0] ? cloneImageData(inputs[0]) : null;
        break;
      default:
        result = null;
    }
  } catch (err) {
    // Surface the failure but don't abort the whole DAG — downstream nodes
    // can still produce useful previews from sibling branches.
    result = null;
  }

  cache.set(nodeId, result);
  return result;
}

export function installCompGraph() {
  if (_installed) return { ok: true, already: true };
  _installed = true;

  const ops = {
    __studioCompCreateGraph: ({ name } = {}) => {
      if (!name) return { ok: false, error: 'name required' };
      _graphs.set(name, _newGraph(name));
      return { ok: true, name };
    },

    __studioCompAddNode: ({ name, kind, params = {} } = {}) => {
      const g = _graphs.get(name);
      if (!g || !NODE_KINDS.includes(kind)) return { ok: false };
      const id = `n_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      g.nodes.set(id, { id, kind, params: { ...params } });
      return { ok: true, id };
    },

    __studioCompSetParams: ({ name, id, params = {} } = {}) => {
      const g = _graphs.get(name); if (!g) return { ok: false };
      const n = g.nodes.get(id); if (!n) return { ok: false };
      n.params = { ...n.params, ...params };
      return { ok: true };
    },

    __studioCompConnect: ({ name, from, to } = {}) => {
      const g = _graphs.get(name); if (!g) return { ok: false };
      if (!g.nodes.has(from) || !g.nodes.has(to)) return { ok: false, error: 'unknown node id' };
      g.edges.push({ from, to });
      return { ok: true };
    },

    __studioCompDisconnect: ({ name, from, to } = {}) => {
      const g = _graphs.get(name); if (!g) return { ok: false };
      const before = g.edges.length;
      g.edges = g.edges.filter((e) => !(e.from === from && e.to === to));
      return { ok: true, removed: before - g.edges.length };
    },

    __studioCompEvaluate: async ({ name, outputId, asImageData = false } = {}) => {
      const g = _graphs.get(name);
      if (!g) return { ok: false };
      const cache = new Map();
      const final = await _evalNode(g, outputId, cache);
      if (!final) return { ok: false, error: 'evaluation produced no image' };
      if (asImageData) return { ok: true, imageData: final, width: final.width, height: final.height };
      const dataUrl = imageDataToDataUrl(final);
      return { ok: true, dataUrl, width: final.width, height: final.height };
    },

    __studioCompListNodes: ({ name } = {}) => {
      const g = _graphs.get(name); if (!g) return { ok: false };
      return { ok: true, nodes: [...g.nodes.values()].map((n) => ({ id: n.id, kind: n.kind, params: n.params })) };
    },

    __studioCompListEdges: ({ name } = {}) => {
      const g = _graphs.get(name); if (!g) return { ok: false };
      return { ok: true, edges: g.edges.slice() };
    },

    __studioCompListNodeKinds: () => ({ ok: true, kinds: NODE_KINDS.slice() }),
    __studioCompListGraphs: () => ({ ok: true, names: [..._graphs.keys()] }),

    __studioCompDeleteGraph: ({ name } = {}) => {
      const had = _graphs.delete(name);
      return { ok: had };
    },
  };

  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'Compositing graph (Nuke/Fusion-style)');
  return { ok: true };
}

export default installCompGraph;
