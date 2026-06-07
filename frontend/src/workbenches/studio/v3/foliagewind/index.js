// ArchDisc Studio V3 — foliage wind animation (slice 827).
// Per-vertex sway driven by 2-octave perlin time noise. Strength scaled
// by vertex Y (more sway at leaves than trunk).

import { registerOps } from '../common/registry.js';
let _installed = false;
const _registered = new Map();
function _hash(x, y, t) { return Math.sin(x * 12.9898 + y * 78.233 + t * 37.719) * 43758.5453 % 1; }
function _tick() {
  const t = performance.now() / 1000;
  for (const { meshUuid, basePos, strength, freq } of _registered.values()) {
    const scene = window.__archdiscScene;
    const m = scene?.getObjectByProperty('uuid', meshUuid);
    if (!m?.geometry?.attributes?.position) continue;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const bx = basePos[i*3], by = basePos[i*3+1], bz = basePos[i*3+2];
      const heightFactor = Math.max(0, by) * 8;
      const offX = (_hash(bx, bz, t * freq) - 0.5) * strength * heightFactor;
      const offZ = (_hash(bz, bx, t * freq + 7) - 0.5) * strength * heightFactor;
      pos.setXYZ(i, bx + offX, by, bz + offZ);
    }
    pos.needsUpdate = true;
  }
}
function _register({ meshUuid, strength = 0.0008, freq = 1.2 } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const m = scene.getObjectByProperty('uuid', meshUuid); if (!m?.geometry?.attributes?.position) return { ok: false };
  const pos = m.geometry.attributes.position;
  const basePos = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) { basePos[i*3]=pos.getX(i); basePos[i*3+1]=pos.getY(i); basePos[i*3+2]=pos.getZ(i); }
  _registered.set(meshUuid, { meshUuid, basePos, strength, freq });
  // Wire into viewport tick
  const vp = window.__archdiscViewport;
  if (vp && !vp.__studioFoliageWindHook) {
    const prev = vp.__studioAnimTick;
    vp.__studioAnimTick = (n) => { if (prev) prev(n); _tick(); };
    vp.__studioFoliageWindHook = true;
  }
  return { ok: true };
}
export function installFoliageWind() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioFoliageWindAdd: _register,
    __studioFoliageWindRemove: ({ meshUuid } = {}) => { _registered.delete(meshUuid); return { ok: true }; },
    __studioFoliageWindList: () => ({ ok: true, items: [..._registered.keys()] }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'fx', 'Foliage wind animation');
  return { ok: true };
}
export default installFoliageWind;
