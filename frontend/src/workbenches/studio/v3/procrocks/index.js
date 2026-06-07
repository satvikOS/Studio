// ArchDisc Studio V3 — procedural rock generator (slice 802).
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
const _PRESETS = ['boulder', 'cobble', 'granite', 'limestone', 'sandstone', 'scree', 'cliff', 'pebble'];
function _hash(x, y, z) { return (Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453) % 1; }
function _generate({ preset = 'boulder', seed = 1337, size = 0.03, roughness = 0.5 } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const geom = new THREE.IcosahedronGeometry(size, 3);
  const pos = geom.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n1 = _hash(x * 50 + seed, y * 50, z * 50);
    const n2 = _hash(x * 100 + seed, y * 100, z * 100) * 0.5;
    const n3 = _hash(x * 200 + seed, y * 200, z * 200) * 0.25;
    const noise = (n1 + n2 + n3) * roughness;
    const r = 1 + (Math.abs(noise) - 0.3) * 0.4;
    pos.setXYZ(i, x * r, y * r, z * r);
  }
  geom.computeVertexNormals();
  const tints = { boulder: 0x665544, cobble: 0x554433, granite: 0x9090a0, limestone: 0xccc8b0, sandstone: 0xd0a070, scree: 0x665050, cliff: 0x554433, pebble: 0xaaa088 };
  const mat = new THREE.MeshStandardMaterial({ color: tints[preset] || 0x888888, roughness: 0.9 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'procrock';
  scene.add(mesh);
  return { ok: true, uuid: mesh.uuid, preset };
}
export function installProcRocks() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioProcRockGenerate: _generate,
    __studioProcRockListPresets: () => ({ ok: true, presets: _PRESETS.slice() }),
    __studioProcRockList: () => {
      const items = [];
      window.__archdiscScene?.traverse((o) => { if (o.userData?.archdiscStudioPrimitiveKind === 'procrock') items.push(o.uuid); });
      return { ok: true, items };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'foliage', 'Procedural rock generator');
  return { ok: true };
}
export default installProcRocks;
