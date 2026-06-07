// ArchDisc Studio V3 — motion vector G-buffer (slice 798).
import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { on: false, prevMatrices: new WeakMap(), texture: null };
function _capture() {
  if (typeof window === 'undefined') return;
  const scene = window.__archdiscScene;
  if (!scene) return;
  const mvs = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const prev = _state.prevMatrices.get(o);
    const cur = o.matrixWorld.elements.slice();
    if (prev) {
      const dx = cur[12] - prev[12], dy = cur[13] - prev[13], dz = cur[14] - prev[14];
      mvs.push({ uuid: o.uuid, mv: [dx, dy, dz] });
    }
    _state.prevMatrices.set(o, cur);
  });
  return mvs;
}
export function installMotionVecFX() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioMotionVecEnable: ({ on } = {}) => { if (on != null) _state.on = !!on; return { ok: true, on: _state.on }; },
    __studioMotionVecCapture: () => ({ ok: true, mvs: _capture() || [] }),
    __studioMotionVecGetTexture: () => ({ ok: true, texture: _state.texture }),
    __studioMotionVecGetStats: () => ({ ok: true, on: _state.on }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rt', 'Motion vector G-buffer');
  return { ok: true };
}
export default installMotionVecFX;
