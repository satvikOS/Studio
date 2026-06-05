// ArchDisc Studio V3 — shader-graph ↔ GPU PT bridge autoload entry.
//
// Side-effect installer matching rtgpu/autoload.js + shader/autoload.js.
// Two install paths:
//
//   1. api.js orchestrator wire-up:  import('./shaderptbridge/autoload.js')
//   2. e2e specs dynamic-import this URL directly:
//        await import('/src/workbenches/studio/v3/shaderptbridge/autoload.js')
//
// We defer one microtask so the install lands after registerV3Api()
// has populated the command registry; our installer enriches it with
// category 'rt' entries (sitting alongside the slice-693 GPU PT and
// the slice-684 CPU tracer ops).

import { installShaderPTBridge } from './index.js';

try {
  if (typeof window !== 'undefined') {
    Promise.resolve().then(() => {
      try { installShaderPTBridge(); } catch (_) { /* swallow */ }
    });
  }
} catch (_) { /* ignore */ }

export default installShaderPTBridge;
