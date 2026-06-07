// ArchDisc Studio V3 — cinematic lens flare (slice 793).
// Procedural elements (streak/ghost/halo) at projected light positions.

import { registerOps } from '../common/registry.js';

let _installed = false;
const _flares = new Map();

function _project(world, camera, w, h) {
  const v = world.clone().project(camera);
  return { x: (v.x * 0.5 + 0.5) * w, y: (1 - (v.y * 0.5 + 0.5)) * h, z: v.z };
}

function _renderFlares(canvas) {
  if (!canvas) return { ok: false };
  const vp = window.__archdiscViewport;
  if (!vp) return { ok: false };
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  for (const { worldPos, color, intensity, anamorphic } of _flares.values()) {
    const p = _project(worldPos, vp.camera, W, H);
    if (p.z < 0 || p.z > 1) continue;
    const cx = `rgba(${color[0]},${color[1]},${color[2]},`;
    // Halo
    const halo = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, intensity * 80);
    halo.addColorStop(0, cx + '0.8)');
    halo.addColorStop(1, cx + '0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);
    // Streak (anamorphic horizontal)
    if (anamorphic) {
      const streak = ctx.createLinearGradient(0, p.y, W, p.y);
      streak.addColorStop(0, cx + '0)');
      streak.addColorStop(0.5, cx + (intensity * 0.5).toFixed(2) + ')');
      streak.addColorStop(1, cx + '0)');
      ctx.fillStyle = streak;
      ctx.fillRect(0, p.y - 1, W, 2);
    }
    // Ghosts along light-center vector
    const ghostCount = 6;
    for (let g = 1; g <= ghostCount; g++) {
      const t = g / (ghostCount + 1);
      const gx = W / 2 + (p.x - W / 2) * (1 - t * 2);
      const gy = H / 2 + (p.y - H / 2) * (1 - t * 2);
      const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, intensity * 10 * t);
      grad.addColorStop(0, cx + (intensity * 0.3 * t).toFixed(2) + ')');
      grad.addColorStop(1, cx + '0)');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }
  }
  return { ok: true, count: _flares.size };
}

export function installLensFlareFX() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioLensFlareAdd: ({ worldPos, color = [255, 255, 200], intensity = 1, anamorphic = true } = {}) => {
      if (!worldPos) return { ok: false, error: 'worldPos required' };
      const id = `flare_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const wp = window.THREE ? new window.THREE.Vector3(worldPos[0], worldPos[1], worldPos[2]) : { ...worldPos, clone: () => ({ ...worldPos, project: () => ({ x: 0, y: 0, z: 0.5 }) }) };
      _flares.set(id, { worldPos: wp, color, intensity, anamorphic });
      return { ok: true, id };
    },
    __studioLensFlareRemove: ({ id } = {}) => { _flares.delete(id); return { ok: true }; },
    __studioLensFlareList: () => ({ ok: true, ids: [..._flares.keys()] }),
    __studioLensFlareRender: ({ canvas } = {}) => _renderFlares(canvas),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'Anamorphic lens flare');
  return { ok: true };
}

export default installLensFlareFX;
