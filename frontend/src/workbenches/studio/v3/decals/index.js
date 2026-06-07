// ArchDisc Studio V3 — decal projector (slice 799).
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
const _decals = new Map();
function _add({ targetMeshUuid, textureUrl, position = [0, 0, 0], rotation = [0, 0, 0], size = [0.05, 0.05, 0.05], opacity = 1 }) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false, error: 'no scene' };
  // Simple decal: a flat quad overlay at given position/rotation.
  const geom = new THREE.PlaneGeometry(size[0], size[1]);
  const mat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    color: 0xffffff,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
  });
  if (textureUrl) {
    const loader = new THREE.TextureLoader();
    loader.load(textureUrl, (tex) => { mat.map = tex; mat.needsUpdate = true; });
  }
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(...position);
  mesh.rotation.set(...rotation);
  mesh.userData.archdiscStudioDecal = true;
  scene.add(mesh);
  const id = `decal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  _decals.set(id, { uuid: mesh.uuid, targetMeshUuid, opacity });
  return { ok: true, id, uuid: mesh.uuid };
}
export function installDecals() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioDecalAdd: _add,
    __studioDecalRemove: ({ id } = {}) => {
      const d = _decals.get(id); if (!d) return { ok: false };
      const scene = window.__archdiscScene;
      const m = scene?.getObjectByProperty('uuid', d.uuid);
      if (m) { scene.remove(m); m.geometry?.dispose(); m.material?.dispose(); }
      _decals.delete(id); return { ok: true };
    },
    __studioDecalSetOpacity: ({ id, opacity } = {}) => {
      const d = _decals.get(id); if (!d) return { ok: false };
      const m = window.__archdiscScene?.getObjectByProperty('uuid', d.uuid);
      if (m?.material) m.material.opacity = opacity;
      return { ok: true };
    },
    __studioDecalList: () => ({ ok: true, ids: [..._decals.keys()] }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'texpaint', 'Decal projector');
  return { ok: true };
}
export default installDecals;
