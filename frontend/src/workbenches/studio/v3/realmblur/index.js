// ArchDisc Studio V3 — real motion blur via motion vectors (slice 912).
// Per-pixel streak blur driven by slice 798 motion vector G-buffer.

import { registerOps } from '../common/registry.js';
let _installed = false;
function _apply({ imageData, motionVectors, width, height, samples = 8, strength = 1 } = {}) {
  if (!imageData) return { ok: false };
  const out = new ImageData(width, height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      let mv = [0, 0];
      if (motionVectors) {
        mv = [motionVectors[idx * 2] || 0, motionVectors[idx * 2 + 1] || 0];
      }
      let r = 0, g = 0, b = 0, n = 0;
      for (let s = 0; s < samples; s++) {
        const t = (s / Math.max(1, samples - 1)) - 0.5;
        const sx = Math.round(x + mv[0] * t * strength);
        const sy = Math.round(y + mv[1] * t * strength);
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
        const si = (sy * width + sx) * 4;
        r += imageData.data[si]; g += imageData.data[si + 1]; b += imageData.data[si + 2]; n++;
      }
      const oi = idx * 4;
      out.data[oi]     = n > 0 ? r / n : imageData.data[oi];
      out.data[oi + 1] = n > 0 ? g / n : imageData.data[oi + 1];
      out.data[oi + 2] = n > 0 ? b / n : imageData.data[oi + 2];
      out.data[oi + 3] = 255;
    }
  }
  return { ok: true, out };
}
export function installRealMBlur() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = { __studioRealMBlurApply: _apply };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'Real per-pixel motion blur (motion-vector driven)');
  return { ok: true };
}
export default installRealMBlur;
