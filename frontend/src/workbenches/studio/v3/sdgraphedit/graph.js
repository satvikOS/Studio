// ArchDisc Studio V3 — Substance Designer-style visual node graph editor
// (slice 791).
//
// `SDGraph` is the in-memory DAG model that the visual editor (and the
// __studioSDGraph* ops in index.js) drive. Each node is a typed unit with
// `params` and a `type` looked up in `NODE_TYPES` (see nodeTypes.js); each
// edge connects an upstream node's single scalar output to a named input
// port on a downstream node.
//
// Evaluation is strictly bottom-up via DFS topological order with a
// memoising cache so a diamond DAG doesn't re-cook a shared generator.
// The output of `evaluate(outputNodeId)` is always a single-channel
// Float32Array sized by the node-graph default of 256×256 (matching the
// slice-775 sdgen surface so generator+filter outputs are buffer-compatible
// and can be cross-piped here without conversion).
//
// Cycle handling: a graph that has a cycle reachable from the requested
// output produces `{ok:false, error:'cycle'}` (no infinite recursion).
//
// Pure JS, no deps. Three.js conversion happens via the `dataUrl` returned
// by the op layer in index.js, not in this module.
//
// Layout: row-major, indexed `i = y * size + x`, scalar luminance in [0, 1].

const DEFAULT_SIZE = 256;

function _flatBuf(size, value) {
  const buf = new Float32Array(size * size);
  if (value !== 0) buf.fill(value);
  return buf;
}

export class SDGraph {
  constructor(name) {
    this.name = String(name || 'graph');
    this.nodes = []; // [{id, type, params}]
    this.edges = []; // [{fromNode, toNode, port}]
    this._seq = 1;
    this._nodeTypes = null; // late-bound from outside so the graph stays
                            // independent of the registry shape.
    this.size = DEFAULT_SIZE;
  }

  // Inject the node-type registry. Done by index.js so this module has
  // zero hard dependency on nodeTypes.js (keeps tests trivial).
  setNodeTypes(registry) {
    this._nodeTypes = registry;
  }

  _uid() { return `n${this._seq++}`; }

  // ── DAG mutation ───────────────────────────────────────────────────
  addNode(type, params) {
    const nodeId = this._uid();
    this.nodes.push({
      id: nodeId,
      type: String(type || ''),
      params: params && typeof params === 'object' ? { ...params } : {},
    });
    return nodeId;
  }

  // Find a node by id.
  getNode(nodeId) {
    return this.nodes.find((n) => n.id === nodeId) || null;
  }

  // Connect upstream `fromNode` -> downstream `toNode` on its `port`.
  // Re-connecting the same `(toNode, port)` replaces the previous edge so
  // a node's input slot only ever has one feeding edge — matches how the
  // visual editor draws connections.
  connect(fromNode, toNode, port) {
    if (!this.getNode(fromNode) || !this.getNode(toNode)) return false;
    if (fromNode === toNode) return false;
    const portName = String(port || 'in');
    this.edges = this.edges.filter(
      (e) => !(e.toNode === toNode && e.port === portName)
    );
    this.edges.push({ fromNode, toNode, port: portName });
    return true;
  }

  // Disconnect every edge targeting `(toNode, port)`. No-op if absent.
  disconnect(toNode, port) {
    const portName = String(port || 'in');
    const before = this.edges.length;
    this.edges = this.edges.filter(
      (e) => !(e.toNode === toNode && e.port === portName)
    );
    return this.edges.length !== before;
  }

  // Drop a node + every edge touching it.
  removeNode(nodeId) {
    const before = this.nodes.length;
    this.nodes = this.nodes.filter((n) => n.id !== nodeId);
    this.edges = this.edges.filter(
      (e) => e.fromNode !== nodeId && e.toNode !== nodeId
    );
    return this.nodes.length !== before;
  }

  // Inputs feeding `nodeId` — { port → fromNodeId }.
  inputsOf(nodeId) {
    const ins = {};
    for (const e of this.edges) {
      if (e.toNode === nodeId) ins[e.port] = e.fromNode;
    }
    return ins;
  }

  // ── Cycle detection ────────────────────────────────────────────────
  // Returns true if any cycle is reachable upstream from `outputNodeId`.
  hasCycle(outputNodeId) {
    const visiting = new Set();
    const visited = new Set();
    const stack = [];
    const start = outputNodeId || (this.nodes.length
      ? this.nodes[this.nodes.length - 1].id : null);
    if (!start) return false;
    function _walk(graph, nodeId) {
      if (visited.has(nodeId)) return false;
      if (visiting.has(nodeId)) return true;
      visiting.add(nodeId);
      stack.push(nodeId);
      const ins = graph.inputsOf(nodeId);
      for (const port of Object.keys(ins)) {
        const upstream = ins[port];
        if (_walk(graph, upstream)) return true;
      }
      visiting.delete(nodeId);
      visited.add(nodeId);
      stack.pop();
      return false;
    }
    return _walk(this, start);
  }

  // ── Evaluation ─────────────────────────────────────────────────────
  // Walk the DAG bottom-up (DFS from `outputNodeId`) and return the
  // Float32Array produced by the node at `outputNodeId`.
  //
  // The graph's `size` (default 256) is forwarded to every generator that
  // accepts a `size` param so the entire pipeline operates on
  // size-compatible buffers and filters can stack without resampling.
  //
  // Returns { ok, buffer, size, evaluatedCount } on success or
  // { ok:false, error } on failure.
  evaluate(outputNodeId) {
    const types = this._nodeTypes;
    if (!types) return { ok: false, error: 'no node types' };
    const out = outputNodeId || (this.nodes.length
      ? this.nodes[this.nodes.length - 1].id : null);
    if (!out) return { ok: false, error: 'no nodes' };
    if (!this.getNode(out)) return { ok: false, error: 'unknown output node' };
    if (this.hasCycle(out)) return { ok: false, error: 'cycle' };

    const cache = new Map(); // nodeId → Float32Array
    const size = this.size;
    const graph = this;
    let evaluatedCount = 0;

    function _eval(nodeId) {
      if (cache.has(nodeId)) return cache.get(nodeId);
      const node = graph.getNode(nodeId);
      if (!node) {
        // Return a flat-mid buffer so a missing reference doesn't crash
        // the pipeline (visual editor often has dangling inputs while a
        // user is still wiring things up).
        return _flatBuf(size, 0.5);
      }
      const def = types[node.type];
      if (!def) return _flatBuf(size, 0.5);

      // Walk upstream inputs.
      const ins = graph.inputsOf(nodeId);
      const inputBuffers = {};
      const expectedPorts = Array.isArray(def.inputs) ? def.inputs : [];
      for (const port of expectedPorts) {
        const upstreamId = ins[port];
        if (upstreamId) {
          inputBuffers[port] = _eval(upstreamId);
        }
      }

      const params = { ...(node.params || {}), size };
      let buf;
      try {
        buf = def.compute(inputBuffers, params, node);
      } catch (_) {
        buf = _flatBuf(size, 0);
      }
      // Defensive: anything that isn't a size² Float32Array gets
      // coerced. Filters that widen (sdgen HSV with rgb:true) would
      // mismatch — we keep the previous mid-grey fallback so the DAG
      // stays evaluable.
      if (!(buf instanceof Float32Array) || buf.length !== size * size) {
        buf = _flatBuf(size, 0.5);
      }
      cache.set(nodeId, buf);
      evaluatedCount += 1;
      return buf;
    }

    const buffer = _eval(out);
    return { ok: true, buffer, size, evaluatedCount };
  }

  // Serialise to a JSON-safe object — used by the visual editor for
  // save/restore and for the `__studioSDGraphList()` op surface.
  toJSON() {
    return {
      name: this.name,
      size: this.size,
      nodes: this.nodes.map((n) => ({ id: n.id, type: n.type, params: { ...n.params } })),
      edges: this.edges.map((e) => ({ fromNode: e.fromNode, toNode: e.toNode, port: e.port })),
    };
  }
}

export const SD_GRAPH_DEFAULT_SIZE = DEFAULT_SIZE;
