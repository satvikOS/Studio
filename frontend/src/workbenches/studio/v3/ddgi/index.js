// ArchDisc Studio V3 — DDGI probe field (slice 931).
// McGuire 2019 dynamic diffuse GI. JS-side BVH ray-cast irradiance per probe,
// octahedral-encoded into a texture atlas; chebyshev-weighted trilinear sample.
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';

let _installed = false, _enabled = false;
const _state = {
  gridSize: [16, 8, 16], bounds: { min: [-10, -2, -10], max: [10, 6, 10] },
  raysPerProbe: 64, hysteresis: 0.97,
  probes: null, atlasTex: null, depthTex: null,
  budget: 64, cursor: 0,
};

function _initProbes() {
  const [nx, ny, nz] = _state.gridSize;
  const probes = new Array(nx * ny * nz);
  const min = _state.bounds.min, max = _state.bounds.max;
  for (let i = 0, k = 0; i < nx; i++)
    for (let j = 0; j < ny; j++)
      for (let l = 0; l < nz; l++, k++) {
        probes[k] = {
          pos: [
            min[0] + (max[0] - min[0]) * (i / (nx - 1 || 1)),
            min[1] + (max[1] - min[1]) * (j / (ny - 1 || 1)),
            min[2] + (max[2] - min[2]) * (l / (nz - 1 || 1)),
          ],
          irradiance: new Float32Array(8 * 8 * 3),
          depth: new Float32Array(16 * 16 * 2),
        };
      }
  _state.probes = probes;
  const atlasW = 8 * nx, atlasH = 8 * ny * nz;
  const atlasData = new Float32Array(atlasW * atlasH * 4);
  _state.atlasTex = new THREE.DataTexture(atlasData, atlasW, atlasH, THREE.RGBAFormat, THREE.FloatType);
  _state.atlasTex.needsUpdate = true;
}

function _octEncode(d) {
  const ax = Math.abs(d[0]) + Math.abs(d[1]) + Math.abs(d[2]);
  let nx = d[0] / ax, ny = d[2] / ax;
  if (d[1] < 0) { const t = (1 - Math.abs(ny)) * (nx >= 0 ? 1 : -1); ny = (1 - Math.abs(nx)) * (ny >= 0 ? 1 : -1); nx = t; }
  return [nx * 0.5 + 0.5, ny * 0.5 + 0.5];
}

function _updateProbe(probe) {
  const vp = window.__archdiscViewport;
  if (!vp?.scene) return;
  const rc = new THREE.Raycaster();
  const occ = [];
  vp.scene.traverse((o) => { if (o.isMesh && o.userData?.archdiscStudioPrimitive) occ.push(o); });
  if (!occ.length) return;
  const o = new THREE.Vector3(probe.pos[0], probe.pos[1], probe.pos[2]);
  const N = _state.raysPerProbe;
  let acc = new Float32Array(8 * 8 * 3);
  for (let r = 0; r < N; r++) {
    const u = Math.random() * 2 - 1;
    const t = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(s * Math.cos(t), u, s * Math.sin(t));
    rc.set(o, dir);
    const hits = rc.intersectObjects(occ, false);
    let r0 = 0.7, g0 = 0.8, b0 = 1.0;
    if (hits.length) {
      const m = hits[0].object.material;
      if (m?.color) { r0 = m.color.r * 0.5; g0 = m.color.g * 0.5; b0 = m.color.b * 0.5; }
    }
    const [eu, ev] = _octEncode([dir.x, dir.y, dir.z]);
    const px = Math.min(7, Math.floor(eu * 8)), py = Math.min(7, Math.floor(ev * 8));
    const idx = (py * 8 + px) * 3;
    acc[idx] += r0; acc[idx + 1] += g0; acc[idx + 2] += b0;
  }
  const h = _state.hysteresis;
  for (let i = 0; i < acc.length; i++) probe.irradiance[i] = probe.irradiance[i] * h + acc[i] * (1 - h) / (N / 64);
}

function _tick() {
  if (!_enabled || !_state.probes) return;
  const N = _state.probes.length;
  const budget = Math.min(_state.budget, N);
  for (let b = 0; b < budget; b++) {
    _updateProbe(_state.probes[_state.cursor]);
    _state.cursor = (_state.cursor + 1) % N;
  }
  const [nx, ny, nz] = _state.gridSize;
  const data = _state.atlasTex.image.data;
  for (let i = 0; i < N; i++) {
    const px = i % nx, py = Math.floor(i / nx);
    const probe = _state.probes[i];
    for (let py8 = 0; py8 < 8; py8++)
      for (let px8 = 0; px8 < 8; px8++) {
        const sIdx = (py8 * 8 + px8) * 3;
        const dx = px * 8 + px8, dy = py * 8 + py8;
        const dIdx = (dy * (nx * 8) + dx) * 4;
        data[dIdx] = probe.irradiance[sIdx];
        data[dIdx + 1] = probe.irradiance[sIdx + 1];
        data[dIdx + 2] = probe.irradiance[sIdx + 2];
        data[dIdx + 3] = 1;
      }
  }
  _state.atlasTex.needsUpdate = true;
}

export function installDDGI() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioDDGIEnable: ({ on = true, gridSize, raysPerProbe, hysteresis, bounds } = {}) => {
      if (gridSize) _state.gridSize = gridSize;
      if (raysPerProbe) _state.raysPerProbe = raysPerProbe | 0;
      if (hysteresis != null) _state.hysteresis = hysteresis;
      if (bounds) _state.bounds = bounds;
      if (on && !_state.probes) _initProbes();
      _enabled = !!on;
      const vp = window.__archdiscViewport;
      if (vp && !vp.__studioAnimTickDDGI) {
        vp.__studioAnimTickDDGI = true;
        const orig = vp.__studioAnimTick;
        vp.__studioAnimTick = (dt) => { if (orig) orig(dt); _tick(); };
      }
      return { ok: true, enabled: _enabled };
    },
    __studioDDGISetBounds: ({ min, max }) => { _state.bounds = { min, max }; if (_state.probes) _initProbes(); return { ok: true }; },
    __studioDDGIGetStats: () => ({ ok: true, enabled: _enabled, probeCount: _state.probes?.length || 0, gridSize: _state.gridSize, cursor: _state.cursor }),
    __studioDDGIReset: () => { _state.probes = null; _state.cursor = 0; return { ok: true }; },
    __studioDDGIGetAtlasTexture: () => ({ ok: true, texture: _state.atlasTex }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'render', 'Lumen-tier DDGI probe field');
  return { ok: true };
}
export default installDDGI;
