// Slice 723 — Niagara visual node editor (data model only — UI canvas
// rendering is wired via Three.js HTML overlays which the existing
// slice-668 cmd palette + slice-700 ghgraph approach handles). This
// module exposes a graph of typed nodes (Emitter → Modules → Renderer)
// that compiles down to slice-703 niagara system operations, giving
// Niagara users the full node-paradigm.

const _graphs = new Map();
let _seq = 1;
function _uid() { return `nia-${_seq++}-${Date.now().toString(36)}`; }

const MODULE_DEFS = {
  // Emitter modules.
  spawnRate: { kind: 'emit', emit: (params) => ({ spawnRate: Number(params.rate) || 50 }) },
  burstSpawn: { kind: 'emit', emit: (params) => ({ burst: Number(params.count) || 10 }) },
  // Particle-life modules.
  initialVelocity: { kind: 'life', emit: (params) => ({ velocity: params.velocity || [0, 1, 0] }) },
  gravity: { kind: 'life', emit: (params) => ({ gravity: params.gravity || [0, -1.2, 0] }) },
  drag: { kind: 'life', emit: (params) => ({ drag: Number(params.drag) || 0.02 }) },
  curl: { kind: 'life', emit: (params) => ({ curlAmp: Number(params.amp) || 0.2, curlFreq: Number(params.freq) || 0.4 }) },
  sizeOverLife: { kind: 'life', emit: (params) => ({ sizeMin: Number(params.min) || 4, sizeMax: Number(params.max) || 12 }) },
  colorOverLife: { kind: 'life', emit: (params) => ({ colorStart: params.start || [1, 0.7, 0.2], colorEnd: params.end || [0.4, 0.1, 0] }) },
  // Renderer modules.
  spriteRenderer: { kind: 'render', emit: (params) => ({ renderType: 'sprite' }) },
  meshRenderer: { kind: 'render', emit: (params) => ({ renderType: 'mesh' }) },
};

export function createGraph() {
  const id = _uid();
  _graphs.set(id, {
    id,
    modules: [],
    systemId: null,
  });
  return { ok: true, id };
}

export function addModule(graphId, moduleKind, params) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  const def = MODULE_DEFS[moduleKind];
  if (!def) return { ok: false, error: 'unknown module: ' + moduleKind };
  const uuid = _uid();
  g.modules.push({ uuid, moduleKind, params: params || {} });
  return { ok: true, uuid };
}

export function removeModule(graphId, uuid) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  g.modules = g.modules.filter((m) => m.uuid !== uuid);
  return { ok: true };
}

export function setParams(graphId, uuid, params) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  const m = g.modules.find((x) => x.uuid === uuid);
  if (!m) return { ok: false };
  m.params = { ...m.params, ...params };
  return { ok: true };
}

export function compile(graphId) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  const out = {
    emitter: {},
    modules: {},
    renderer: { renderType: 'sprite' },
  };
  for (const m of g.modules) {
    const def = MODULE_DEFS[m.moduleKind];
    if (!def) continue;
    const patch = def.emit(m.params);
    if (def.kind === 'emit') Object.assign(out.emitter, patch);
    else if (def.kind === 'life') Object.assign(out.modules, patch);
    else if (def.kind === 'render') Object.assign(out.renderer, patch);
  }
  return { ok: true, compiled: out };
}

export function spawn(graphId) {
  const g = _graphs.get(graphId);
  if (!g) return { ok: false };
  const c = compile(graphId);
  if (!c.ok) return c;
  if (typeof window.__studioNiagaraCreate !== 'function') return { ok: false, error: 'slice-703 niagara not loaded' };
  // Tear down old.
  if (g.systemId) {
    try { window.__studioNiagaraDestroy(g.systemId); } catch (_) {}
  }
  const r = window.__studioNiagaraCreate({
    ...c.compiled.emitter,
    ...c.compiled.modules,
  });
  if (r.ok) g.systemId = r.id;
  return r;
}

export function despawn(graphId) {
  const g = _graphs.get(graphId);
  if (!g || !g.systemId) return { ok: false };
  if (typeof window.__studioNiagaraDestroy === 'function') {
    window.__studioNiagaraDestroy(g.systemId);
  }
  g.systemId = null;
  return { ok: true };
}

export function listGraphs() {
  return {
    ok: true,
    graphs: Array.from(_graphs.values()).map((g) => ({
      id: g.id, moduleCount: g.modules.length, systemId: g.systemId,
    })),
  };
}

export function listModuleKinds() {
  return {
    ok: true,
    kinds: Object.entries(MODULE_DEFS).map(([k, d]) => ({ kind: k, type: d.kind })),
  };
}
