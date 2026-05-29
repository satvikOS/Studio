import { evaluateGraph } from '../nodegraph/nodeGraphEval.js';

/*
 * Studio Niagara-style particle EMITTER graph (Unreal Niagara / Unity VFX
 * Graph). A data-flow graph of modules — Spawn (count/lifetime), Initial
 * Velocity (+ spread), Force (gravity/wind), Colour-over-Life — feeds an Emitter
 * Output node that assembles an emitter spec. A deterministic burst simulator
 * then evolves the particles (pos = o + v*age + 0.5*F*age^2), so the cloud is
 * fully reproducible (index-hashed spread, no Math.random).
 */

const fract = (x) => x - Math.floor(x);
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const hash = (i, k) => fract(Math.sin(i * 12.9898 + k * 78.233) * 43758.5453);
const hexToRgb = (h) => { const n = parseInt(String(h).replace('#', ''), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

export const NIAGARA_NODE_TYPES = {
  spawn: {
    label: 'Spawn Burst',
    inputs: [], outputs: ['cfg'],
    params: [{ key: 'count', type: 'number', default: 400 }, { key: 'lifetime', type: 'number', default: 2 }],
    eval(_i, p) { return { kind: 'cfg', cfg: 'spawn', count: Math.max(1, Math.round(p.count || 400)), lifetime: Math.max(0.1, p.lifetime ?? 2) }; },
  },
  velocity: {
    label: 'Initial Velocity',
    inputs: [], outputs: ['cfg'],
    params: [{ key: 'vx', type: 'number', default: 0 }, { key: 'vy', type: 'number', default: 0 }, { key: 'vz', type: 'number', default: 0 }, { key: 'spread', type: 'number', default: 0.4 }],
    eval(_i, p) { return { kind: 'cfg', cfg: 'velocity', vel: [p.vx || 0, p.vy || 0, p.vz || 0], spread: p.spread ?? 0.4 }; },
  },
  force: {
    label: 'Force',
    inputs: [], outputs: ['cfg'],
    params: [{ key: 'fx', type: 'number', default: 0 }, { key: 'fy', type: 'number', default: -1.2 }, { key: 'fz', type: 'number', default: 0 }],
    eval(_i, p) { return { kind: 'cfg', cfg: 'force', force: [p.fx || 0, p.fy ?? -1.2, p.fz || 0] }; },
  },
  colorOverLife: {
    label: 'Color over Life',
    inputs: [], outputs: ['cfg'],
    params: [{ key: 'startColor', type: 'color', default: '#ffd060' }, { key: 'endColor', type: 'color', default: '#401010' }],
    eval(_i, p) { return { kind: 'cfg', cfg: 'color', startColor: p.startColor || '#ffd060', endColor: p.endColor || '#401010' }; },
  },
  emitter: {
    label: 'Emitter Output',
    inputs: ['spawn', 'velocity', 'force', 'color'], outputs: [],
    params: [{ key: 'size', type: 'number', default: 0.02 }],
    eval(inp, p) {
      const sp = inp.spawn || {}; const vel = inp.velocity || {}; const fo = inp.force || {}; const co = inp.color || {};
      return {
        kind: 'emitter',
        spec: {
          count: sp.count || 400,
          lifetime: sp.lifetime || 2,
          vel: vel.vel || [0, 0, 0],
          spread: vel.spread != null ? vel.spread : 0.4,
          force: fo.force || [0, -1.2, 0],
          startColor: co.startColor || '#ffd060',
          endColor: co.endColor || '#401010',
          size: p.size ?? 0.02,
          origin: [0, 0.1, 0],
        },
      };
    },
  },
};

let _nid = 1;
export function niagaraSeed() {
  const s = { id: `spawn${_nid++}`, type: 'spawn', x: 30, y: 40, params: { count: 500, lifetime: 2 } };
  const v = { id: `velocity${_nid++}`, type: 'velocity', x: 30, y: 150, params: { vx: 0, vy: 0.2, vz: 0, spread: 0.5 } };
  const f = { id: `force${_nid++}`, type: 'force', x: 30, y: 270, params: { fx: 0, fy: -1.2, fz: 0 } };
  const c = { id: `colorOverLife${_nid++}`, type: 'colorOverLife', x: 30, y: 380, params: { startColor: '#ffd060', endColor: '#401010' } };
  const e = { id: `emitter${_nid++}`, type: 'emitter', x: 320, y: 190, params: { size: 0.02 } };
  return {
    nodes: [s, v, f, c, e],
    edges: [
      { from: { node: s.id, port: 'cfg' }, to: { node: e.id, port: 'spawn' } },
      { from: { node: v.id, port: 'cfg' }, to: { node: e.id, port: 'velocity' } },
      { from: { node: f.id, port: 'cfg' }, to: { node: e.id, port: 'force' } },
      { from: { node: c.id, port: 'cfg' }, to: { node: e.id, port: 'color' } },
    ],
  };
}

export function evalNiagaraGraph(graph) {
  const res = evaluateGraph(graph, NIAGARA_NODE_TYPES);
  if (res.error) return { error: res.error };
  const out = res.geometry;
  if (!out || out.kind !== 'emitter') return { error: 'no emitter output' };
  return { spec: out.spec };
}

// Deterministic burst simulation at time t -> particle positions + colours.
export function simulateEmitter(spec, t) {
  const n = spec.count;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const o = spec.origin || [0, 0.1, 0];
  const sc = hexToRgb(spec.startColor), ec = hexToRgb(spec.endColor);
  const F = spec.force, V = spec.vel, sp = spec.spread;
  for (let i = 0; i < n; i++) {
    const vx = V[0] + (hash(i, 1) - 0.5) * 2 * sp;
    const vy = V[1] + (hash(i, 2) - 0.5) * 2 * sp;
    const vz = V[2] + (hash(i, 3) - 0.5) * 2 * sp;
    const age = Math.min(Math.max(0, t), spec.lifetime);
    positions[i * 3] = o[0] + vx * age + 0.5 * F[0] * age * age;
    positions[i * 3 + 1] = o[1] + vy * age + 0.5 * F[1] * age * age;
    positions[i * 3 + 2] = o[2] + vz * age + 0.5 * F[2] * age * age;
    const lt = clamp01(age / spec.lifetime);
    colors[i * 3] = (sc[0] + (ec[0] - sc[0]) * lt) / 255;
    colors[i * 3 + 1] = (sc[1] + (ec[1] - sc[1]) * lt) / 255;
    colors[i * 3 + 2] = (sc[2] + (ec[2] - sc[2]) * lt) / 255;
  }
  return { positions, colors, count: n };
}
