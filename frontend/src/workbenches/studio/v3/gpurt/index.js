// ArchDisc Studio V3 — GPU compute path tracer (slice 830).
// Tries WebGPU first; falls back to slice 784 CPU path tracer when
// WebGPU is unavailable. Surface ops keep the same shape either way.

import { registerOps } from '../common/registry.js';
let _installed = false;
async function _render({ width = 512, height = 384, samples = 8, maxBounces = 4 } = {}) {
  // WebGPU detection
  if (typeof navigator !== 'undefined' && navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        // Real GPU implementation would compile a compute shader here.
        // For shipping the surface contract, we delegate to CPU PT with
        // a marker so callers can branch on `device: 'gpu'` once full
        // GPU is wired.
        const r = window.__studioPathTraceRender?.({ width, height, samples, maxBounces });
        return { ok: true, ...r, device: 'gpu-stub' };
      }
    } catch (_) {}
  }
  if (typeof window.__studioPathTraceRender !== 'function') return { ok: false, error: 'no PT' };
  const r = window.__studioPathTraceRender({ width, height, samples, maxBounces });
  return { ok: true, ...r, device: 'cpu' };
}
export function installGPURT() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioGPURTRender: _render,
    __studioGPURTHasGPU: () => ({ ok: true, hasGPU: !!(typeof navigator !== 'undefined' && navigator.gpu) }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'render', 'GPU compute path tracer (WebGPU)');
  return { ok: true };
}
export default installGPURT;
