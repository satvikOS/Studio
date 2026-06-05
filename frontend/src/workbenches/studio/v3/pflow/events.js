// Slice 698 — Particle Flow events + operator registry.

import { mulberry32 } from '../common/random.js';

const _events = new Map();
let _seq = 1;
function _uuid() { return `pf-${_seq++}-${Date.now().toString(36)}`; }

export function createEvent(name, opts) {
  const uuid = _uuid();
  const ev = {
    uuid,
    name: name || `event_${_events.size + 1}`,
    operators: [],
    tests: [],
    transitions: [],
    enabled: true,
  };
  _events.set(uuid, ev);
  return ev;
}

export function getEvent(uuid) { return _events.get(uuid); }
export function listEvents() { return Array.from(_events.values()); }
export function removeEvent(uuid) { return _events.delete(uuid); }

export function setOperator(eventUuid, opName, params) {
  const ev = _events.get(eventUuid);
  if (!ev) return { ok: false };
  ev.operators = (ev.operators || []).filter((o) => o.name !== opName);
  ev.operators.push({ name: opName, params: params || {} });
  return { ok: true };
}

export function setTest(eventUuid, idx, kind, params) {
  const ev = _events.get(eventUuid);
  if (!ev) return { ok: false };
  ev.tests[idx] = { kind, params: params || {} };
  return { ok: true };
}

export function connect(srcUuid, srcTestIdx, dstUuid) {
  const ev = _events.get(srcUuid);
  if (!ev) return { ok: false };
  ev.transitions[srcTestIdx] = dstUuid;
  return { ok: true };
}

// Runtime operator application on a particle (mutates in place).
export function applyOperators(particle, event, dt, rng) {
  for (const op of event.operators) {
    if (op.name === 'velocity' && particle._velSet !== true) {
      const dir = op.params.direction || [0, 1, 0];
      const variance = op.params.variance || 0;
      particle.vx = dir[0] + (rng() - 0.5) * variance;
      particle.vy = dir[1] + (rng() - 0.5) * variance;
      particle.vz = dir[2] + (rng() - 0.5) * variance;
      particle._velSet = true;
    } else if (op.name === 'gravity') {
      particle.vy -= (op.params.g ?? 9.81) * dt;
    } else if (op.name === 'wind') {
      const w = op.params.wind || [0.5, 0, 0];
      particle.vx += w[0] * dt;
      particle.vy += w[1] * dt;
      particle.vz += w[2] * dt;
    } else if (op.name === 'seekTarget') {
      const t = op.params.target || [0, 0, 0];
      const dx = t[0] - particle.x, dy = t[1] - particle.y, dz = t[2] - particle.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      const k = op.params.strength ?? 1;
      particle.vx += dx / len * k * dt;
      particle.vy += dy / len * k * dt;
      particle.vz += dz / len * k * dt;
    } else if (op.name === 'kill') {
      particle.dead = true;
    }
  }
  if (!particle.dead) {
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.z += particle.vz * dt;
  }
  particle.age = (particle.age || 0) + dt;
}

export function evaluateTests(particle, event, rng) {
  for (let i = 0; i < event.tests.length; i++) {
    const t = event.tests[i];
    if (!t) continue;
    let passed = false;
    if (t.kind === 'ageOver') passed = particle.age > (t.params.seconds ?? 1);
    else if (t.kind === 'speedBelow') passed = Math.hypot(particle.vx, particle.vy, particle.vz) < (t.params.v ?? 0.1);
    else if (t.kind === 'randomChance') passed = rng() < (t.params.p ?? 0.01);
    else if (t.kind === 'altitudeBelow') passed = particle.y < (t.params.y ?? 0);
    if (passed && event.transitions[i]) {
      return event.transitions[i];
    }
  }
  return null;
}
