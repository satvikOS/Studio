// ArchDisc Studio V3 — Megascans-style asset loader (slice 904).
// Loads a .gltf with PBR + 4K texture-set (albedo/normal/roughness/AO/
// displacement). Wires all maps to MeshPhysicalMaterial.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { registerOps } from '../common/registry.js';
let _installed = false;
const _loader = new GLTFLoader();
async function _load({ glbUrl, albedoUrl, normalUrl, roughnessUrl, aoUrl, dispUrl, name = 'megascan' } = {}) {
  try {
    if (!glbUrl) return { ok: false, error: 'glbUrl required' };
    const gltf = await _loader.loadAsync(glbUrl);
    const root = gltf.scene;
    const texLoader = new THREE.TextureLoader();
    const maps = {};
    if (albedoUrl) maps.map = await new Promise((res) => texLoader.load(albedoUrl, res));
    if (normalUrl) maps.normalMap = await new Promise((res) => texLoader.load(normalUrl, res));
    if (roughnessUrl) maps.roughnessMap = await new Promise((res) => texLoader.load(roughnessUrl, res));
    if (aoUrl) maps.aoMap = await new Promise((res) => texLoader.load(aoUrl, res));
    if (dispUrl) maps.displacementMap = await new Promise((res) => texLoader.load(dispUrl, res));
    root.traverse((o) => {
      if (o.isMesh) {
        const mat = new THREE.MeshPhysicalMaterial({ roughness: 0.9, metalness: 0 });
        Object.assign(mat, maps);
        if (maps.aoMap && o.geometry?.attributes?.uv && !o.geometry.attributes.uv1) {
          o.geometry.setAttribute('uv1', o.geometry.attributes.uv);
        }
        o.material = mat;
        o.userData.archdiscStudioPrimitive = true;
        o.userData.archdiscStudioPrimitiveKind = 'megaload';
        o.userData.archdiscStudioMegaName = name;
      }
    });
    const scene = window.__archdiscScene;
    if (scene) scene.add(root);
    return { ok: true, uuid: root.uuid, mapCount: Object.keys(maps).length };
  } catch (e) { return { ok: false, error: String(e) }; }
}
export function installMegaLoad() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioMegaLoad: _load,
    __studioMegaList: () => {
      const items = [];
      window.__archdiscScene?.traverse((o) => { if (o.userData?.archdiscStudioPrimitiveKind === 'megaload') items.push({ uuid: o.uuid, name: o.userData.archdiscStudioMegaName }); });
      return { ok: true, items };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'interop', 'Megascans-style PBR asset loader');
  return { ok: true };
}
export default installMegaLoad;
