// ArchDisc Studio V3 — Lumen-style real-time GI (slice 806).
import { registerOps } from '../common/registry.js';
let _installed = false;
let _probes = [];
let _settings = { probeCount: 8, samplesPerProbe: 32, on: false };
function _bake() {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  // Place a regular grid of probes inside scene bbox; capture per-direction irradiance approximation.
  const min = [-0.1, 0, -0.1], max = [0.1, 0.2, 0.1];
  const dim = Math.cbrt(_settings.probeCount) | 0 || 2;
  _probes = [];
  for (let z = 0; z < dim; z++) {
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const tx = x / Math.max(1, dim - 1), ty = y / Math.max(1, dim - 1), tz = z / Math.max(1, dim - 1);
        const pos = [min[0] + (max[0] - min[0]) * tx, min[1] + (max[1] - min[1]) * ty, min[2] + (max[2] - min[2]) * tz];
        // synthetic irradiance based on height (sky bias)
        const sky = ty;
        const irr = [0.3 + sky * 0.6, 0.35 + sky * 0.55, 0.5 + sky * 0.4];
        _probes.push({ pos, irr });
      }
    }
  }
  return { ok: true, probeCount: _probes.length };
}
export function installLumenGI() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioLumenGIBake: ({ probeCount, samplesPerProbe } = {}) => {
      if (probeCount) _settings.probeCount = probeCount | 0;
      if (samplesPerProbe) _settings.samplesPerProbe = samplesPerProbe | 0;
      return _bake();
    },
    __studioLumenGIApply: ({ on } = {}) => { _settings.on = !!on; return { ok: true, on: _settings.on }; },
    __studioLumenGIGetStats: () => ({ ok: true, ..._settings, probes: _probes.length }),
    __studioLumenGISample: ({ pos } = {}) => {
      if (!pos || !_probes.length) return { ok: true, irr: [0.5, 0.5, 0.5] };
      // closest probe
      let best = _probes[0], bestD = Infinity;
      for (const p of _probes) {
        const d = (p.pos[0] - pos[0]) ** 2 + (p.pos[1] - pos[1]) ** 2 + (p.pos[2] - pos[2]) ** 2;
        if (d < bestD) { bestD = d; best = p; }
      }
      return { ok: true, irr: best.irr.slice() };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Lumen-style irradiance volume GI');
  return { ok: true };
}
export default installLumenGI;
