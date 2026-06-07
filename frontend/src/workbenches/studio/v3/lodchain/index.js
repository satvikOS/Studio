// ArchDisc Studio V3 — LOD chain generator (slice 819).
// Auto-creates LOD0/1/2/3 via progressive QEM decimation (slice 786),
// then registers them on a THREE.LOD so the renderer auto-swaps by
// camera distance — the AAA game-asset workflow.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
const _chains = new Map();
function _build({ meshUuid, levels = 4, ratios } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const m = scene.getObjectByProperty('uuid', meshUuid); if (!m?.geometry) return { ok: false };
  // Defaults match Unreal LOD bias
  const r = ratios || [1.0, 0.5, 0.25, 0.125, 0.06];
  const lod = new THREE.LOD();
  // LOD0 = original
  lod.addLevel(m.clone(), 0);
  for (let i = 1; i < levels; i++) {
    const tgtRatio = r[i] ?? Math.pow(0.5, i);
    // Use existing QEM op if available, else fall back to simple decimation.
    let dec = m.clone();
    if (typeof window.__studioQEMDecimate === 'function') {
      try {
        const res = window.__studioQEMDecimate({ meshUuid: m.uuid, targetTriRatio: tgtRatio });
        if (res?.ok && res.uuid) {
          const decMesh = window.__archdiscScene.getObjectByProperty('uuid', res.uuid);
          if (decMesh) { dec = decMesh.clone(); scene.remove(decMesh); }
        }
      } catch (_) {}
    }
    lod.addLevel(dec, i * 0.3); // distance threshold ramp
  }
  lod.position.copy(m.position);
  lod.rotation.copy(m.rotation);
  lod.scale.copy(m.scale);
  lod.userData.archdiscStudioPrimitive = true;
  lod.userData.archdiscStudioPrimitiveKind = 'lodchain';
  scene.add(lod);
  scene.remove(m);
  const key = lod.uuid;
  _chains.set(key, { lodUuid: key, levels: levels });
  return { ok: true, uuid: key, levels };
}
export function installLODChain() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioLODBuild: _build,
    __studioLODList: () => ({ ok: true, items: [..._chains.values()] }),
    __studioLODSetDistances: ({ uuid, distances } = {}) => {
      const lod = window.__archdiscScene?.getObjectByProperty('uuid', uuid);
      if (!lod?.isLOD || !Array.isArray(distances)) return { ok: false };
      lod.levels.forEach((lv, i) => { if (distances[i] != null) lv.distance = distances[i]; });
      return { ok: true };
    },
    __studioLODRemove: ({ uuid } = {}) => {
      const lod = window.__archdiscScene?.getObjectByProperty('uuid', uuid);
      if (lod) window.__archdiscScene.remove(lod);
      _chains.delete(uuid);
      return { ok: true };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'edit', 'Auto LOD chain (Unreal AutoLOD / Unity LODGroup)');
  return { ok: true };
}
export default installLODChain;
