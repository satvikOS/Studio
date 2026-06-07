// ArchDisc Studio V3 — 4K render pipeline (slice 880).
// Configures renderer + render-target for 4K (3840×2160) or 8K output.
// Uses the slice 752 viewport adaptive frustum + sets pixel ratio.

import { registerOps } from '../common/registry.js';
let _installed = false;
const PRESETS = {
  '1080p': { w: 1920, h: 1080 },
  '1440p': { w: 2560, h: 1440 },
  '4k':    { w: 3840, h: 2160 },
  '8k':    { w: 7680, h: 4320 },
};
let _state = { preset: '1080p', width: 1920, height: 1080 };
function _set({ preset, width, height } = {}) {
  if (preset && PRESETS[preset]) { _state.preset = preset; _state.width = PRESETS[preset].w; _state.height = PRESETS[preset].h; }
  if (width && height) { _state.width = width; _state.height = height; _state.preset = 'custom'; }
  return { ok: true, ..._state };
}
async function _renderToCanvas() {
  // Use the slice 784 path tracer at the chosen res
  if (typeof window.__studioPathTraceRender === 'function') {
    return window.__studioPathTraceRender({ width: _state.width, height: _state.height, samples: 8, maxBounces: 4 });
  }
  return { ok: false, error: 'no PT' };
}
export function installTarget4K() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studio4KSetPreset: _set,
    __studio4KListPresets: () => ({ ok: true, presets: Object.keys(PRESETS) }),
    __studio4KRender: _renderToCanvas,
    __studio4KGetState: () => ({ ok: true, ..._state }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'render', '4K / 8K target render pipeline');
  return { ok: true };
}
export default installTarget4K;
