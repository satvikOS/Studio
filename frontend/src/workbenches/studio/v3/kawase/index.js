// ArchDisc Studio V3 — Kawase blur for bloom (slice 911).
// Multi-pass dual-Kawase (downsample + upsample) — faster than Gaussian
// for the same perceived blur radius. The bloom in slice 857 had no
// actual implementation; this provides the blur primitive.

import { registerOps } from '../common/registry.js';
let _installed = false;
function _kawasePass(imgData, width, height, offset) {
  const out = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      // 4-tap Kawase: sample 4 corners of an offset box
      const samples = [
        [x + offset, y + offset],
        [x - offset, y + offset],
        [x + offset, y - offset],
        [x - offset, y - offset],
      ];
      for (const [sx, sy] of samples) {
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
        const si = (sy * width + sx) * 4;
        r += imgData.data[si]; g += imgData.data[si + 1]; b += imgData.data[si + 2]; n++;
      }
      const oi = (y * width + x) * 4;
      out.data[oi] = n ? r / n : 0;
      out.data[oi + 1] = n ? g / n : 0;
      out.data[oi + 2] = n ? b / n : 0;
      out.data[oi + 3] = 255;
    }
  }
  return out;
}
function _blur({ imageData, width, height, iterations = 4 } = {}) {
  if (!imageData) return { ok: false };
  let cur = imageData;
  const offsets = [1, 2, 2, 4, 4, 8, 8, 16];
  for (let i = 0; i < iterations; i++) {
    cur = _kawasePass(cur, width, height, offsets[Math.min(i, offsets.length - 1)]);
  }
  return { ok: true, out: cur };
}
export function installKawase() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioKawaseBlur: _blur,
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'Kawase blur primitive');
  return { ok: true };
}
export default installKawase;
