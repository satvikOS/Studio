// ArchDisc Studio V3 — ROTO / matte painting (slice 868).
// Bezier-spline shape over a canvas overlay → alpha matte for compositing.

import { registerOps } from '../common/registry.js';
let _installed = false;
const _shapes = new Map();
function _drawShape(canvas, shape) {
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'black'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'white';
  ctx.beginPath();
  if (shape.points?.length) {
    ctx.moveTo(shape.points[0].x * canvas.width, shape.points[0].y * canvas.height);
    for (let i = 1; i < shape.points.length; i++) {
      const p = shape.points[i];
      ctx.lineTo(p.x * canvas.width, p.y * canvas.height);
    }
    ctx.closePath(); ctx.fill();
  }
}
export function installRotoMatte() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioRotoCreate: ({ id, points } = {}) => {
      if (!id) id = `roto_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      _shapes.set(id, { id, points: points || [], feather: 0 });
      return { ok: true, id };
    },
    __studioRotoSetPoints: ({ id, points } = {}) => {
      const s = _shapes.get(id); if (!s) return { ok: false };
      s.points = points || []; return { ok: true };
    },
    __studioRotoSetFeather: ({ id, feather } = {}) => {
      const s = _shapes.get(id); if (!s) return { ok: false };
      s.feather = feather || 0; return { ok: true };
    },
    __studioRotoRenderMatte: ({ id, width = 512, height = 512 } = {}) => {
      const s = _shapes.get(id); if (!s) return { ok: false };
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      _drawShape(canvas, s);
      if (s.feather > 0) {
        const ctx = canvas.getContext('2d'); ctx.filter = `blur(${s.feather}px)`;
        ctx.drawImage(canvas, 0, 0);
      }
      return { ok: true, dataUrl: canvas.toDataURL('image/png') };
    },
    __studioRotoList: () => ({ ok: true, ids: [..._shapes.keys()] }),
    __studioRotoDelete: ({ id } = {}) => { _shapes.delete(id); return { ok: true }; },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'ROTO matte painting');
  return { ok: true };
}
export default installRotoMatte;
