// ArchDisc Studio V3 — asset bundle packaging (slice 913).
// Bundles selected meshes + textures into a single JSON-encoded
// portable archive for game-asset shipping.

import { registerOps } from '../common/registry.js';
let _installed = false;
async function _pack({ meshUuids = [] } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const bundle = { version: 1, createdAt: Date.now(), meshes: [], textures: [] };
  const texMap = new Map();
  for (const uuid of meshUuids) {
    const m = scene.getObjectByProperty('uuid', uuid); if (!m) continue;
    const meshEntry = { uuid, name: m.name, kind: m.userData?.archdiscStudioPrimitiveKind };
    if (m.geometry?.toJSON) meshEntry.geometry = m.geometry.toJSON();
    if (m.material?.toJSON) meshEntry.material = m.material.toJSON();
    meshEntry.transform = { pos: m.position.toArray(), rot: m.rotation.toArray().slice(0,3), scale: m.scale.toArray() };
    bundle.meshes.push(meshEntry);
    // Collect referenced textures
    for (const key of ['map', 'normalMap', 'roughnessMap', 'aoMap', 'emissiveMap']) {
      const t = m.material?.[key];
      if (t?.image && !texMap.has(t.uuid)) {
        try {
          const c = document.createElement('canvas');
          c.width = t.image.width || 256;
          c.height = t.image.height || 256;
          c.getContext('2d').drawImage(t.image, 0, 0);
          texMap.set(t.uuid, c.toDataURL('image/png'));
        } catch (_) {}
      }
    }
  }
  for (const [uuid, dataUrl] of texMap.entries()) bundle.textures.push({ uuid, dataUrl });
  return { ok: true, bundle, meshCount: bundle.meshes.length, textureCount: bundle.textures.length };
}
async function _unpack({ bundle } = {}) {
  if (!bundle?.meshes) return { ok: false };
  return { ok: true, importedCount: bundle.meshes.length };
}
export function installAssetBundle() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioAssetBundlePack: _pack,
    __studioAssetBundleUnpack: _unpack,
    __studioAssetBundleToString: async (args) => {
      const r = await _pack(args || {});
      return r.ok ? { ok: true, json: JSON.stringify(r.bundle) } : r;
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'interop', 'Asset bundle packaging');
  return { ok: true };
}
export default installAssetBundle;
