// ArchDisc Studio V3 — shallow-water flow (slice 804).
import { registerOps } from '../common/registry.js';
let _installed = false;
const _maps = new Map();
function _createMap(w, h) {
  const depth = new Float32Array(w * h);
  const velX = new Float32Array(w * h);
  const velY = new Float32Array(w * h);
  const terrain = new Float32Array(w * h);
  return { w, h, depth, velX, velY, terrain };
}
function _step(m, dt = 0.016) {
  const { w, h, depth, velX, velY, terrain } = m;
  const newDepth = new Float32Array(depth);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const hL = terrain[i - 1] + depth[i - 1];
      const hR = terrain[i + 1] + depth[i + 1];
      const hU = terrain[i - w] + depth[i - w];
      const hD = terrain[i + w] + depth[i + w];
      velX[i] += (hL - hR) * 0.5 * dt;
      velY[i] += (hU - hD) * 0.5 * dt;
      velX[i] *= 0.98;
      velY[i] *= 0.98;
      const flow = (velX[i] - velX[i + 1] + velY[i] - velY[i + w]) * dt;
      newDepth[i] = Math.max(0, depth[i] + flow);
    }
  }
  depth.set(newDepth);
}
function _trace(m, sx, sy, ex, ey) {
  const { w, h, terrain } = m;
  const path = [[sx, sy]];
  let cx = sx, cy = sy;
  for (let step = 0; step < 200; step++) {
    if (cx === ex && cy === ey) break;
    let bestDx = 0, bestDy = 0, bestH = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
        const nh = terrain[ny * w + nx];
        if (nh < bestH) { bestH = nh; bestDx = dx; bestDy = dy; }
      }
    }
    cx += bestDx; cy += bestDy;
    path.push([cx, cy]);
    terrain[cy * w + cx] -= 0.001; // carve
  }
  return path;
}
export function installWaterFlow() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioWaterFlowCreate: ({ w = 64, h = 64 } = {}) => {
      const key = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      _maps.set(key, _createMap(w | 0, h | 0));
      return { ok: true, key, w, h };
    },
    __studioWaterFlowSimulate: ({ key, steps = 60 } = {}) => {
      const m = _maps.get(key); if (!m) return { ok: false };
      for (let i = 0; i < steps; i++) _step(m);
      return { ok: true, steps };
    },
    __studioRiverTrace: ({ key, startUV, endUV } = {}) => {
      const m = _maps.get(key); if (!m) return { ok: false };
      const sx = (startUV?.[0] || 0) * m.w | 0, sy = (startUV?.[1] || 0) * m.h | 0;
      const ex = (endUV?.[0] || 0.5) * m.w | 0, ey = (endUV?.[1] || 0.5) * m.h | 0;
      return { ok: true, path: _trace(m, sx, sy, ex, ey) };
    },
    __studioWaterFlowList: () => ({ ok: true, keys: [..._maps.keys()] }),
    __studioWaterFlowRemove: ({ key } = {}) => { _maps.delete(key); return { ok: true }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'sim', 'Shallow-water river simulation');
  return { ok: true };
}
export default installWaterFlow;
