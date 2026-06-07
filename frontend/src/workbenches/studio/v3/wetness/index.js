// ArchDisc Studio V3 — wetness / puddle detection (slice 828).
// Marks horizontal up-facing surfaces as wet by raising clearcoat
// + darkening albedo + lowering roughness.

import { registerOps } from '../common/registry.js';
let _installed = false;
function _apply({ meshUuid, wetness = 1.0, upThreshold = 0.85 } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const m = scene.getObjectByProperty('uuid', meshUuid); if (!m?.geometry || !m?.material) return { ok: false };
  m.geometry.computeVertexNormals();
  // Average normal Y of mesh
  const nor = m.geometry.attributes.normal;
  let avgY = 0; for (let i = 0; i < nor.count; i++) avgY += nor.getY(i);
  avgY /= nor.count;
  const isHorizontal = avgY > upThreshold;
  if (!isHorizontal) return { ok: true, applied: false, avgNormalY: avgY };
  if (m.material.roughness != null) m.material.roughness = Math.max(0.05, m.material.roughness * (1 - wetness * 0.7));
  if (m.material.clearcoat != null) m.material.clearcoat = Math.min(1, (m.material.clearcoat || 0) + wetness * 0.6);
  if (m.material.color) m.material.color.multiplyScalar(1 - wetness * 0.25);
  m.material.needsUpdate = true;
  m.userData.archdiscStudioWetness = wetness;
  return { ok: true, applied: true, wetness };
}
export function installWetness() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioWetnessApply: _apply,
    __studioWetnessClear: ({ meshUuid } = {}) => {
      const m = window.__archdiscScene?.getObjectByProperty('uuid', meshUuid);
      if (m) delete m.userData.archdiscStudioWetness;
      return { ok: true };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'texpaint', 'Wet surface puddle detection');
  return { ok: true };
}
export default installWetness;
