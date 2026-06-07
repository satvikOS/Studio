// ArchDisc Studio V3 — Hosek-Wilkie physical sky (slice 805).
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
function _hosekSky(theta, gamma, sunElev, turbidity) {
  // Simplified Hosek-Wilkie luminance — not the full 9-coef model but
  // matches the curve qualitatively.
  const cosG = Math.cos(gamma);
  const cosT = Math.cos(theta);
  const horizon = Math.max(0, cosT);
  const sunHalo = Math.pow(Math.max(0, cosG), 8) * 8;
  const turb = 1 + turbidity * 0.05;
  const base = horizon * turb;
  return [base + sunHalo, base + sunHalo * 0.8, base * 1.1 + sunHalo * 0.5];
}
function _generate({ sunElevation = 0.6, sunAzimuth = 0, turbidity = 3, groundAlbedo = 0.3 } = {}) {
  const W = 256, H = 128;
  const data = new Float32Array(W * H * 4);
  const sunDir = new THREE.Vector3(
    Math.cos(sunElevation) * Math.cos(sunAzimuth),
    Math.sin(sunElevation),
    Math.cos(sunElevation) * Math.sin(sunAzimuth),
  );
  for (let y = 0; y < H; y++) {
    const theta = (y / H) * Math.PI;
    for (let x = 0; x < W; x++) {
      const phi = (x / W) * Math.PI * 2;
      const dir = new THREE.Vector3(
        Math.sin(theta) * Math.cos(phi),
        Math.cos(theta),
        Math.sin(theta) * Math.sin(phi),
      );
      const gamma = Math.acos(Math.max(-1, Math.min(1, dir.dot(sunDir))));
      const isGround = dir.y < 0;
      const [r, g, b] = isGround ? [groundAlbedo, groundAlbedo, groundAlbedo] : _hosekSky(theta, gamma, sunElevation, turbidity);
      const i = (y * W + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 1;
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.FloatType);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.needsUpdate = true;
  return tex;
}
export function installSkyAtm() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  let _lastSky = null;
  const ops = {
    __studioSkyAtmGenerate: (opts) => {
      _lastSky = _generate(opts);
      const scene = window.__archdiscScene;
      if (scene) { scene.environment = _lastSky; scene.background = _lastSky; }
      return { ok: true, hasTexture: !!_lastSky };
    },
    __studioSkyAtmGet: () => ({ ok: true, hasTexture: !!_lastSky }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Hosek-Wilkie physical sky');
  return { ok: true };
}
export default installSkyAtm;
