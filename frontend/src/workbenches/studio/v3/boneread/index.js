// ArchDisc Studio V3 — skeletal LOD (slice 822).
// Reduce bone count for distant skinned meshes — Unreal Skeletal LOD.
// Drops bones below a per-distance threshold + redistributes their
// skin weights to surviving parents.

import { registerOps } from '../common/registry.js';
let _installed = false;
function _reduce({ skinnedUuid, keepRatio = 0.5 } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const sm = scene.getObjectByProperty('uuid', skinnedUuid);
  if (!sm?.isSkinnedMesh || !sm.skeleton) return { ok: false, error: 'not a skinned mesh' };
  const skel = sm.skeleton;
  const total = skel.bones.length;
  const keepCount = Math.max(1, Math.floor(total * keepRatio));
  const drop = total - keepCount;
  if (drop <= 0) return { ok: true, kept: total, dropped: 0 };
  // Drop the bones with the lowest aggregate skin weight first.
  const wt = sm.geometry.attributes.skinWeight;
  const idx = sm.geometry.attributes.skinIndex;
  if (!wt || !idx) return { ok: false, error: 'no skin attrs' };
  const totals = new Float32Array(total);
  for (let i = 0; i < wt.count; i++) {
    for (let k = 0; k < 4; k++) totals[idx.getComponent(i, k)] += Math.abs(wt.getComponent(i, k));
  }
  const sorted = totals.map((w, b) => ({ w, b })).sort((a, b) => a.w - b.w);
  const drops = new Set(sorted.slice(0, drop).map((e) => e.b));
  // Redistribute dropped weights to bone 0 (root).
  for (let i = 0; i < wt.count; i++) {
    let rootAdd = 0;
    for (let k = 0; k < 4; k++) {
      const b = idx.getComponent(i, k);
      if (drops.has(b)) { rootAdd += Math.abs(wt.getComponent(i, k)); wt.setComponent(i, k, 0); idx.setComponent(i, k, 0); }
    }
    if (rootAdd > 0) wt.setComponent(i, 0, Math.abs(wt.getComponent(i, 0)) + rootAdd);
  }
  wt.needsUpdate = true; idx.needsUpdate = true;
  return { ok: true, kept: keepCount, dropped: drop };
}
export function installBoneReduce() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = { __studioBoneReduce: _reduce };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rig', 'Skeletal LOD bone reduction');
  return { ok: true };
}
export default installBoneReduce;
