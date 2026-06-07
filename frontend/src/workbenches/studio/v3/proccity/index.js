// ArchDisc Studio V3 — procedural city generator (slice 803).
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
function _mul32(s) { return function () { let t = s += 0x6d2b79f5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function _generate({ seed = 1337, blockCount = 6, density = 0.7, maxHeight = 0.05 } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const rng = _mul32(seed);
  const group = new THREE.Group();
  const blockSize = 0.04;
  const spacing = 0.008;
  for (let bx = 0; bx < blockCount; bx++) {
    for (let bz = 0; bz < blockCount; bz++) {
      if (rng() > density) continue;
      const buildingsPerBlock = 1 + (rng() * 3) | 0;
      for (let b = 0; b < buildingsPerBlock; b++) {
        const h = (0.005 + rng() * maxHeight);
        const w = (blockSize / buildingsPerBlock) * 0.8;
        const geom = new THREE.BoxGeometry(w, h, w);
        const colorTone = 0.5 + rng() * 0.3;
        const mat = new THREE.MeshStandardMaterial({
          color: new THREE.Color(colorTone, colorTone, colorTone + 0.05),
          roughness: 0.8,
        });
        const mesh = new THREE.Mesh(geom, mat);
        const px = bx * (blockSize + spacing) - blockCount * (blockSize + spacing) / 2 + (b - buildingsPerBlock / 2) * w * 1.05;
        const pz = bz * (blockSize + spacing) - blockCount * (blockSize + spacing) / 2;
        mesh.position.set(px, h / 2, pz);
        group.add(mesh);
      }
    }
  }
  group.userData.archdiscStudioPrimitive = true;
  group.userData.archdiscStudioPrimitiveKind = 'proccity';
  scene.add(group);
  return { ok: true, uuid: group.uuid, blockCount, childCount: group.children.length };
}
export function installProcCity() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioProcCityGenerate: _generate,
    __studioProcCityList: () => {
      const items = [];
      window.__archdiscScene?.traverse((o) => { if (o.userData?.archdiscStudioPrimitiveKind === 'proccity') items.push(o.uuid); });
      return { ok: true, items };
    },
    __studioProcCityDelete: ({ uuid } = {}) => {
      const o = window.__archdiscScene?.getObjectByProperty('uuid', uuid);
      if (o) window.__archdiscScene.remove(o);
      return { ok: true };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'foliage', 'Procedural city generator');
  return { ok: true };
}
export default installProcCity;
