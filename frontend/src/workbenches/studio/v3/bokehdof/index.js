// ArchDisc Studio V3 — bokeh depth of field (slice 905).
// REAL polygonal-aperture bokeh kernel + CoC (Circle of Confusion)
// sampling. Applied as a post-process via OffscreenCanvas.

import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { focalDistance: 1.0, aperture: 0.05, bladeCount: 6, maxBlur: 20, enabled: false };
function _renderBokeh({ imageData, depthArray, width, height }) {
  const out = new ImageData(width, height);
  const { aperture, focalDistance, bladeCount, maxBlur } = _state;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const depth = depthArray ? depthArray[idx] : 0.5;
      const coc = Math.min(maxBlur, Math.abs(depth - focalDistance) * aperture * 100);
      let r = 0, g = 0, b = 0, w = 0;
      // Sample N points in a polygonal aperture
      const samples = Math.max(1, Math.min(32, coc | 0));
      for (let s = 0; s < samples; s++) {
        const a = (s / samples) * Math.PI * 2;
        const bladeAngle = Math.floor(a / (Math.PI * 2 / bladeCount)) * (Math.PI * 2 / bladeCount);
        const inset = Math.cos(a - bladeAngle) * 0.9;
        const sx = Math.floor(x + Math.cos(a) * coc * inset);
        const sy = Math.floor(y + Math.sin(a) * coc * inset);
        if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
        const sIdx = (sy * width + sx) * 4;
        r += imageData.data[sIdx]; g += imageData.data[sIdx + 1]; b += imageData.data[sIdx + 2]; w++;
      }
      const oIdx = idx * 4;
      out.data[oIdx]     = w > 0 ? r / w : imageData.data[oIdx];
      out.data[oIdx + 1] = w > 0 ? g / w : imageData.data[oIdx + 1];
      out.data[oIdx + 2] = w > 0 ? b / w : imageData.data[oIdx + 2];
      out.data[oIdx + 3] = 255;
    }
  }
  return out;
}
export function installBokehDOF() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioBokehSet: ({ focalDistance, aperture, bladeCount, maxBlur, enabled } = {}) => {
      if (focalDistance != null) _state.focalDistance = focalDistance;
      if (aperture != null) _state.aperture = aperture;
      if (bladeCount != null) _state.bladeCount = bladeCount | 0;
      if (maxBlur != null) _state.maxBlur = maxBlur;
      if (enabled != null) _state.enabled = !!enabled;
      return { ok: true, ..._state };
    },
    __studioBokehApply: ({ imageData, depthArray, width, height } = {}) => {
      if (!imageData) return { ok: false };
      const out = _renderBokeh({ imageData, depthArray, width, height });
      return { ok: true, out };
    },
    __studioBokehGetStats: () => ({ ok: true, ..._state }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'Bokeh depth-of-field');
  return { ok: true };
}
export default installBokehDOF;
