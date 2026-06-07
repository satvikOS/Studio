// ArchDisc Studio V3 — SpeedTree-style procedural trees (slice 800).
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
const _PRESETS = ['oak', 'pine', 'maple', 'willow', 'birch', 'sequoia', 'palm', 'bonsai'];
function _mulberry32(s) { return function () { let t = s += 0x6d2b79f5; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function _buildBranch(group, start, dir, length, radius, depth, maxDepth, rng) {
  const cyl = new THREE.CylinderGeometry(radius * 0.5, radius, length, 6);
  const mat = new THREE.MeshStandardMaterial({ color: 0x4a3020 });
  const segment = new THREE.Mesh(cyl, mat);
  const tip = start.clone().addScaledVector(dir, length);
  const mid = start.clone().addScaledVector(dir, length / 2);
  segment.position.copy(mid);
  segment.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  group.add(segment);
  if (depth >= maxDepth) {
    // leaf
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(length * 0.3, 6, 4),
      new THREE.MeshStandardMaterial({ color: 0x2a8030, transparent: true, opacity: 0.85 }),
    );
    leaf.position.copy(tip);
    group.add(leaf);
    return;
  }
  const branchCount = 2 + Math.floor(rng() * 2);
  for (let b = 0; b < branchCount; b++) {
    const phi = rng() * Math.PI * 2;
    const elev = 0.3 + rng() * 0.5;
    const newDir = new THREE.Vector3(Math.cos(phi) * Math.cos(elev), Math.sin(elev), Math.sin(phi) * Math.cos(elev))
      .normalize().lerp(dir, 0.6).normalize();
    _buildBranch(group, tip, newDir, length * 0.6, radius * 0.6, depth + 1, maxDepth, rng);
  }
}
function _generate({ preset = 'oak', seed = 1337, height = 0.05, branchDepth = 4 } = {}) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const rng = _mulberry32(seed + (_PRESETS.indexOf(preset) | 0));
  const group = new THREE.Group();
  _buildBranch(group, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0), height, height * 0.06, 0, branchDepth, rng);
  group.userData.archdiscStudioPrimitive = true;
  group.userData.archdiscStudioPrimitiveKind = 'speedtree';
  scene.add(group);
  return { ok: true, uuid: group.uuid, preset };
}
export function installSpeedTree() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioSpeedTreeGenerate: _generate,
    __studioSpeedTreeListPresets: () => ({ ok: true, presets: _PRESETS.slice() }),
    __studioSpeedTreeList: () => {
      const scene = window.__archdiscScene; if (!scene) return { ok: true, items: [] };
      const items = [];
      scene.traverse((o) => { if (o.userData?.archdiscStudioPrimitiveKind === 'speedtree') items.push(o.uuid); });
      return { ok: true, items };
    },
    __studioSpeedTreeDelete: ({ uuid } = {}) => {
      const scene = window.__archdiscScene;
      const o = scene?.getObjectByProperty('uuid', uuid);
      if (o) scene.remove(o);
      return { ok: true };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'foliage', 'SpeedTree procedural trees');
  return { ok: true };
}
export default installSpeedTree;
