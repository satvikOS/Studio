// ArchDisc Studio V3 — Substance Designer graph editor node-type registry
// (slice 791).
//
// Maps slice-775 sdgen GENERATORS + FILTERS into the SDGraph compute
// surface. A node type is `{kind, inputs, compute}`:
//   kind     — 'generator' | 'filter' | 'output'  (cosmetic; used by the
//              palette + visual editor to colour nodes by family).
//   inputs   — array of port names the node expects upstream. Generators
//              have []; filters typically have ['in']; the synthetic
//              `output` node has ['in'] and acts as the export sink the
//              evaluator can target.
//   compute  — function(inputBuffers, params, node) → Float32Array.
//              Generators ignore inputBuffers and synthesise from
//              params; filters apply slice-775 fns to inputBuffers.in.
//
// Buffers throughout are scalar-luminance Float32Array of length size×size
// (size defaults to 256, set on the graph). The `output` node is a no-op
// pass-through used as the DAG's evaluation root.
//
// Side effect: this module imports GENERATORS / FILTERS from
// ../sdgen/. Slice 775 is the source of truth — we do NOT duplicate any
// noise / filter code here.

import { GENERATORS, GENERATOR_NAMES } from '../sdgen/generators.js';
import { FILTERS, FILTER_NAMES } from '../sdgen/filters.js';
import { SD_GRAPH_DEFAULT_SIZE } from './graph.js';

function _emptyBuf(size) { return new Float32Array(size * size); }

function _ensureSize(buf, size) {
  if (buf instanceof Float32Array && buf.length === size * size) return buf;
  return _emptyBuf(size);
}

// Build a flat registry mapping node type → {kind, inputs, compute}.
function _buildRegistry() {
  const types = {};

  // ─── Generators (slice 775) ──────────────────────────────────────────
  for (const name of GENERATOR_NAMES) {
    const fn = GENERATORS[name];
    types[name] = {
      kind: 'generator',
      inputs: [],
      compute(_inputs, params, node) {
        const size = Number(params?.size) || SD_GRAPH_DEFAULT_SIZE;
        const seed = Number.isFinite(+params?.seed) ? +params.seed
                   : Number.isFinite(+node?.params?.seed) ? +node.params.seed
                   : 42;
        const out = fn({ ...params, size }, seed);
        return _ensureSize(out, size);
      },
    };
  }

  // ─── Filters (slice 775) ─────────────────────────────────────────────
  for (const name of FILTER_NAMES) {
    const fn = FILTERS[name];
    types[name] = {
      kind: 'filter',
      // Most filters consume a single image input; we use the canonical
      // 'in' port name throughout this module + e2e specs.
      inputs: ['in'],
      compute(inputs, params, _node) {
        const size = Number(params?.size) || SD_GRAPH_DEFAULT_SIZE;
        const inBuf = _ensureSize(inputs?.in, size);
        // Force a single-channel output regardless of caller-supplied
        // rgb flag — the SDGraph evaluator owns the canonical channel
        // shape (size² Float32). Wide outputs are not legal here.
        const safeParams = { ...(params || {}) };
        if (name === 'hsv') safeParams.rgb = false;
        const out = fn(inBuf, safeParams);
        return _ensureSize(out, size);
      },
    };
  }

  // ─── Output sink ─────────────────────────────────────────────────────
  // The visual editor wires a final `output` node so the user can clearly
  // mark which path of the DAG gets exported. Pass-through; the
  // evaluator just returns its input buffer.
  types.output = {
    kind: 'output',
    inputs: ['in'],
    compute(inputs, params, _node) {
      const size = Number(params?.size) || SD_GRAPH_DEFAULT_SIZE;
      return _ensureSize(inputs?.in, size);
    },
  };

  return types;
}

// Cached singleton — slice 775's generators / filters lists never change
// at runtime, so re-importing this module is cheap.
let _cached = null;
export function getNodeTypes() {
  if (!_cached) _cached = _buildRegistry();
  return _cached;
}

// Canonical sorted name lists for palettes / e2e specs.
export const NODE_TYPE_KINDS = Object.freeze({
  generator: GENERATOR_NAMES.slice(),
  filter: FILTER_NAMES.slice(),
  output: ['output'],
});

export function listNodeTypes() {
  const reg = getNodeTypes();
  return Object.keys(reg).map((k) => ({
    type: k,
    kind: reg[k].kind,
    inputs: reg[k].inputs.slice(),
  }));
}
