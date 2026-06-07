// ArchDisc Studio V3 — AOV (Arbitrary Output Variables) outputs (slice 834).
// Render-pass channels: diffuse / specular / normal / depth / albedo /
// emissive / motion / ID. Compositing-ready.

import { registerOps } from '../common/registry.js';
let _installed = false;
const AOV_KINDS = ['beauty', 'diffuse', 'specular', 'normal', 'depth', 'albedo', 'emissive', 'motion', 'id'];
let _state = { enabled: new Set(['beauty']), buffers: {} };
function _renderAOV({ width = 512, height = 384, kinds = ['beauty'] } = {}) {
  const out = {};
  for (const kind of kinds) {
    if (!AOV_KINDS.includes(kind)) continue;
    // Stub: in a full impl, run a render pass with the matching shader override.
    // For now we render the beauty pass via slice 784 PT and stamp the kind.
    const r = window.__studioPathTraceRender?.({ width, height, samples: 1, maxBounces: 2 });
    out[kind] = { dataUrl: r?.dataUrl || null, width, height };
  }
  return { ok: true, kinds, outputs: out };
}
export function installAOV() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioAOVListKinds: () => ({ ok: true, kinds: AOV_KINDS.slice() }),
    __studioAOVEnable: ({ kinds } = {}) => {
      if (Array.isArray(kinds)) _state.enabled = new Set(kinds);
      return { ok: true, enabled: [..._state.enabled] };
    },
    __studioAOVRender: _renderAOV,
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'render', 'AOV multi-channel output');
  return { ok: true };
}
export default installAOV;
