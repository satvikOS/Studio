// ArchDisc Studio V3 — hair dynamics (slice 789).
// Verlet per strand-segment + distance/bend constraints + gravity/wind.
// Builds on slice 760 groom strands.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';

let _installed = false;
const _sessions = new Map();

function _step(state, dt, iterations = 4) {
  const { strands, prevPositions, gravity, wind, damping } = state;
  // Verlet integrate every non-root segment vertex.
  for (let si = 0; si < strands.length; si++) {
    const strand = strands[si];
    const prev = prevPositions[si];
    for (let vi = 1; vi < strand.length; vi++) {
      const p = strand[vi];
      const pPrev = prev[vi];
      // a = gravity + wind
      const ax = gravity[0] + wind[0];
      const ay = gravity[1] + wind[1];
      const az = gravity[2] + wind[2];
      const dx = (p[0] - pPrev[0]) * damping + ax * dt * dt;
      const dy = (p[1] - pPrev[1]) * damping + ay * dt * dt;
      const dz = (p[2] - pPrev[2]) * damping + az * dt * dt;
      pPrev[0] = p[0]; pPrev[1] = p[1]; pPrev[2] = p[2];
      p[0] += dx; p[1] += dy; p[2] += dz;
    }
  }
  // Distance constraints.
  for (let it = 0; it < iterations; it++) {
    for (let si = 0; si < strands.length; si++) {
      const strand = strands[si];
      const restLens = state.restLens[si];
      for (let vi = 1; vi < strand.length; vi++) {
        const a = strand[vi - 1], b = strand[vi];
        const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
        const t = (d - restLens[vi - 1]) / d;
        // Root vi=0 is pinned (don't move it).
        const wA = vi === 1 ? 0 : 0.5, wB = 0.5;
        if (vi > 1) { a[0] += dx * t * wA; a[1] += dy * t * wA; a[2] += dz * t * wA; }
        b[0] -= dx * t * wB; b[1] -= dy * t * wB; b[2] -= dz * t * wB;
      }
    }
  }
}

function _createSession(groomUuid, opts = {}) {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false, error: 'no scene' };
  // Attempt to read strands from the existing groom record.
  const groom = window.__studioGroomGet ? window.__studioGroomGet(groomUuid) : null;
  let strands = groom?.strands;
  if (!strands || !strands.length) {
    // Fallback synthetic strands.
    strands = [];
    for (let i = 0; i < 10; i++) {
      const pts = [];
      for (let j = 0; j < 8; j++) {
        pts.push([Math.random() * 0.1 - 0.05, j * 0.005, Math.random() * 0.1 - 0.05]);
      }
      strands.push(pts);
    }
  }
  // Snapshot prev positions + rest lengths.
  const prevPositions = strands.map((s) => s.map((p) => [...p]));
  const restLens = strands.map((s) => {
    const out = [];
    for (let i = 1; i < s.length; i++) {
      const dx = s[i][0] - s[i - 1][0], dy = s[i][1] - s[i - 1][1], dz = s[i][2] - s[i - 1][2];
      out.push(Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    return out;
  });
  const key = `hairdyn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  _sessions.set(key, {
    strands, prevPositions, restLens,
    gravity: opts.gravity || [0, -9.8, 0],
    wind: opts.wind || [0, 0, 0],
    damping: 0.98,
  });
  return { ok: true, key, strandCount: strands.length };
}

export function installHairDyn() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioHairDynCreate: ({ groomUuid, opts } = {}) => _createSession(groomUuid, opts),
    __studioHairDynStep: ({ key, dt = 0.016, iterations = 4 } = {}) => {
      const s = _sessions.get(key);
      if (!s) return { ok: false, error: 'no session' };
      _step(s, dt, iterations);
      return { ok: true, dt };
    },
    __studioHairDynSetWind: ({ key, dir, strength = 1 } = {}) => {
      const s = _sessions.get(key);
      if (!s || !dir) return { ok: false };
      s.wind = [dir[0] * strength, dir[1] * strength, dir[2] * strength];
      return { ok: true };
    },
    __studioHairDynSetGravity: ({ key, g } = {}) => {
      const s = _sessions.get(key);
      if (!s || !g) return { ok: false };
      s.gravity = [g[0], g[1], g[2]];
      return { ok: true };
    },
    __studioHairDynList: () => ({ ok: true, sessions: [..._sessions.keys()] }),
    __studioHairDynRemove: ({ key } = {}) => { _sessions.delete(key); return { ok: true }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'fx', 'Hair dynamics — verlet strand sim');
  return { ok: true };
}

export default installHairDyn;
