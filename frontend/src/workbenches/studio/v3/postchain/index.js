// ArchDisc Studio V3 — production post-process chain coordinator
// (slice 914). Orchestrates Kawase bloom → motion blur → bokeh DOF →
// vignette → grain → tonemap in a single pass over an ImageData buffer.

import { registerOps } from '../common/registry.js';
let _installed = false;
let _state = { bloom: true, motionBlur: false, dof: false, vignette: true, grain: false, tonemap: 'aces' };
function _aces(x) {
  const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return Math.max(0, Math.min(1, (x * (a * x + b)) / (x * (c * x + d) + e)));
}
function _processFrame({ imageData, width, height, motionVectors, depthArray } = {}) {
  if (!imageData) return { ok: false };
  let cur = new ImageData(new Uint8ClampedArray(imageData.data), width, height);
  // Bloom via Kawase
  if (_state.bloom && typeof window.__studioKawaseBlur === 'function') {
    const bright = new ImageData(width, height);
    for (let i = 0; i < cur.data.length; i += 4) {
      const lum = (cur.data[i] * 0.299 + cur.data[i + 1] * 0.587 + cur.data[i + 2] * 0.114) / 255;
      const bp = Math.max(0, lum - 0.7) * 1.5;
      bright.data[i]     = cur.data[i]     * bp;
      bright.data[i + 1] = cur.data[i + 1] * bp;
      bright.data[i + 2] = cur.data[i + 2] * bp;
      bright.data[i + 3] = 255;
    }
    const blurRes = window.__studioKawaseBlur({ imageData: bright, width, height, iterations: 4 });
    if (blurRes?.ok) {
      const blurred = blurRes.out;
      for (let i = 0; i < cur.data.length; i += 4) {
        cur.data[i]     = Math.min(255, cur.data[i]     + blurred.data[i]);
        cur.data[i + 1] = Math.min(255, cur.data[i + 1] + blurred.data[i + 1]);
        cur.data[i + 2] = Math.min(255, cur.data[i + 2] + blurred.data[i + 2]);
      }
    }
  }
  // Motion blur
  if (_state.motionBlur && typeof window.__studioRealMBlurApply === 'function' && motionVectors) {
    const r = window.__studioRealMBlurApply({ imageData: cur, motionVectors, width, height });
    if (r?.ok) cur = r.out;
  }
  // DOF
  if (_state.dof && typeof window.__studioBokehApply === 'function' && depthArray) {
    const r = window.__studioBokehApply({ imageData: cur, depthArray, width, height });
    if (r?.ok) cur = r.out;
  }
  // Vignette + Tonemap + Grain
  const cx = width / 2, cy = height / 2;
  const maxR = Math.hypot(cx, cy);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      let r = cur.data[i] / 255, g = cur.data[i + 1] / 255, b = cur.data[i + 2] / 255;
      if (_state.tonemap === 'aces') { r = _aces(r); g = _aces(g); b = _aces(b); }
      if (_state.vignette) {
        const d = Math.hypot(x - cx, y - cy) / maxR;
        const v = Math.max(0, 1 - Math.pow(d, 2) * 0.5);
        r *= v; g *= v; b *= v;
      }
      if (_state.grain) {
        const n = (Math.sin(i * 12.9898 + y * 78.233) * 43758.5453 % 1) * 0.05;
        r += n; g += n; b += n;
      }
      cur.data[i]     = Math.max(0, Math.min(255, r * 255));
      cur.data[i + 1] = Math.max(0, Math.min(255, g * 255));
      cur.data[i + 2] = Math.max(0, Math.min(255, b * 255));
    }
  }
  return { ok: true, out: cur };
}
export function installPostChain() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioPostChainSet: (s = {}) => { Object.assign(_state, s); return { ok: true, ..._state }; },
    __studioPostChainProcess: _processFrame,
    __studioPostChainGetState: () => ({ ok: true, ..._state }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'compositing', 'Production post-process chain coordinator');
  return { ok: true };
}
export default installPostChain;
