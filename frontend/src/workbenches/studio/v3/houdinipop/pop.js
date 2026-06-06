// Slice 727 — Houdini POP (Particle Operator) chain. A POP chain is a
// linear sequence of operators that consume + emit particles each
// frame. Ops: location (initial position), velocity (initial v),
// force (per-frame force), attractor (pull toward a point), collision
// (simple plane bounce), kill (age-out). Drives a slice-703 niagara
// system's parameters via a custom emitter callback.

const _chains = new Map();
let _seq = 1;
function _uid() { return `pop-${_seq++}-${Date.now().toString(36)}`; }

const POP_OP_DEFS = {
  location: { kind: 'init', apply: (op, particle) => { particle.position = [...op.params.center || [0, 1, 0]]; } },
  velocity: { kind: 'init', apply: (op, particle) => { particle.velocity = [...op.params.v || [0, 1, 0]]; } },
  force: { kind: 'step', apply: (op, particle, dt) => {
    const f = op.params.force || [0, -1, 0];
    particle.velocity[0] += f[0] * dt;
    particle.velocity[1] += f[1] * dt;
    particle.velocity[2] += f[2] * dt;
  }},
  attractor: { kind: 'step', apply: (op, particle, dt) => {
    const c = op.params.center || [0, 0, 0];
    const k = Number(op.params.strength) || 1;
    const dx = c[0] - particle.position[0], dy = c[1] - particle.position[1], dz = c[2] - particle.position[2];
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    particle.velocity[0] += dx / d * k * dt;
    particle.velocity[1] += dy / d * k * dt;
    particle.velocity[2] += dz / d * k * dt;
  }},
  collision: { kind: 'step', apply: (op, particle, dt) => {
    const planeY = Number(op.params.planeY) || 0;
    const bounce = Number(op.params.bounce) || 0.5;
    if (particle.position[1] < planeY) {
      particle.position[1] = planeY;
      particle.velocity[1] = -particle.velocity[1] * bounce;
    }
  }},
  kill: { kind: 'step', apply: (op, particle, dt) => {
    if (particle.age > (op.params.maxAge || 5)) particle.alive = false;
  }},
};

export function createChain() {
  const id = _uid();
  _chains.set(id, { id, ops: [], particles: [] });
  return { ok: true, id };
}

export function addOp(chainId, kind, params) {
  const c = _chains.get(chainId);
  if (!c) return { ok: false };
  if (!POP_OP_DEFS[kind]) return { ok: false };
  const opUuid = _uid();
  c.ops.push({ uuid: opUuid, kind, params: params || {} });
  return { ok: true, opUuid };
}

export function setParam(chainId, opUuid, params) {
  const c = _chains.get(chainId);
  if (!c) return { ok: false };
  const o = c.ops.find((x) => x.uuid === opUuid);
  if (!o) return { ok: false };
  o.params = { ...o.params, ...params };
  return { ok: true };
}

export function emit(chainId) {
  const c = _chains.get(chainId);
  if (!c) return { ok: false };
  const particle = { position: [0, 0, 0], velocity: [0, 0, 0], age: 0, alive: true };
  for (const op of c.ops) {
    const def = POP_OP_DEFS[op.kind];
    if (def?.kind === 'init') def.apply(op, particle);
  }
  c.particles.push(particle);
  return { ok: true, count: c.particles.length };
}

export function tick(chainId, dt) {
  const c = _chains.get(chainId);
  if (!c) return { ok: false };
  const tStep = Number(dt) || 0.016;
  for (const p of c.particles) {
    if (!p.alive) continue;
    p.age += tStep;
    for (const op of c.ops) {
      const def = POP_OP_DEFS[op.kind];
      if (def?.kind === 'step') def.apply(op, p, tStep);
    }
    p.position[0] += p.velocity[0] * tStep;
    p.position[1] += p.velocity[1] * tStep;
    p.position[2] += p.velocity[2] * tStep;
  }
  c.particles = c.particles.filter((p) => p.alive);
  return { ok: true, alive: c.particles.length };
}

export function getParticles(chainId) {
  const c = _chains.get(chainId);
  if (!c) return { ok: false };
  return { ok: true, particles: c.particles.slice() };
}

export function clearChain(chainId) {
  const c = _chains.get(chainId);
  if (!c) return { ok: false };
  c.particles = [];
  return { ok: true };
}

export function deleteChain(id) {
  return { ok: _chains.delete(id) };
}

export function listChains() {
  return {
    ok: true,
    chains: Array.from(_chains.values()).map((c) => ({
      id: c.id, opCount: c.ops.length, particleCount: c.particles.length,
    })),
  };
}
