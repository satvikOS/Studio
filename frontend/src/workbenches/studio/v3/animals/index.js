// ArchDisc Studio V3 — animal / wildlife templates (slice 829).
// Spawns a stylised quadruped / bird / fish base mesh with simple
// proportions ready for rig + skin.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
const _PRESETS = {
  deer:      { body: [0.04, 0.025, 0.08], head: 0.025, legs: 4, color: 0x8c6c45, legHeight: 0.05 },
  wolf:      { body: [0.045, 0.02, 0.10], head: 0.026, legs: 4, color: 0x707070, legHeight: 0.04 },
  rabbit:    { body: [0.025, 0.018, 0.04], head: 0.018, legs: 4, color: 0xcccc99, legHeight: 0.018 },
  fox:       { body: [0.035, 0.018, 0.07], head: 0.022, legs: 4, color: 0xc06030, legHeight: 0.035 },
  bear:      { body: [0.06, 0.04, 0.10], head: 0.04, legs: 4, color: 0x4a3018, legHeight: 0.04 },
  eagle:     { body: [0.04, 0.025, 0.06], head: 0.018, legs: 2, color: 0x5a4030, legHeight: 0.018, wings: true },
  parrot:    { body: [0.025, 0.018, 0.04], head: 0.015, legs: 2, color: 0x4080c0, legHeight: 0.012, wings: true },
  fish:      { body: [0.025, 0.015, 0.06], head: 0.018, legs: 0, color: 0x4080a0, legHeight: 0 },
  shark:     { body: [0.04, 0.02, 0.12], head: 0.025, legs: 0, color: 0x707080, legHeight: 0 },
  dolphin:   { body: [0.04, 0.025, 0.10], head: 0.025, legs: 0, color: 0x6080a0, legHeight: 0 },
};
function _spawn({ preset = 'deer', position = [0, 0, 0], scale = 1 } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const p = _PRESETS[preset] || _PRESETS.deer;
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.6 });
  // Body
  const body = new THREE.Mesh(new THREE.BoxGeometry(p.body[2] * scale, p.body[1] * scale, p.body[0] * scale), mat);
  body.position.set(0, p.legHeight * scale + p.body[1] * 0.5 * scale, 0);
  group.add(body);
  // Head
  const head = new THREE.Mesh(new THREE.SphereGeometry(p.head * scale, 10, 8), mat);
  head.position.set(p.body[2] * 0.6 * scale, p.legHeight * scale + p.body[1] * scale + p.head * 0.5 * scale, 0);
  group.add(head);
  // Legs
  for (let i = 0; i < p.legs; i++) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.005 * scale, 0.005 * scale, p.legHeight * scale, 6), mat);
    const xs = i < p.legs / 2 ? p.body[2] * 0.4 : -p.body[2] * 0.4;
    const zs = (i % 2 ? 1 : -1) * p.body[0] * 0.4;
    leg.position.set(xs * scale, p.legHeight * 0.5 * scale, zs * scale);
    group.add(leg);
  }
  // Wings
  if (p.wings) {
    const wMat = new THREE.MeshStandardMaterial({ color: p.color, transparent: true, opacity: 0.8, side: THREE.DoubleSide });
    const wing = new THREE.Mesh(new THREE.PlaneGeometry(p.body[2] * scale, p.body[2] * 0.5 * scale), wMat);
    wing.position.set(0, p.legHeight * scale + p.body[1] * 0.8 * scale, p.body[0] * 1.2 * scale);
    wing.rotation.x = -Math.PI / 4;
    group.add(wing);
    const wing2 = wing.clone();
    wing2.position.z = -p.body[0] * 1.2 * scale;
    wing2.rotation.x = Math.PI / 4;
    group.add(wing2);
  }
  // Tail (for fish)
  if (preset === 'fish' || preset === 'shark' || preset === 'dolphin') {
    const tail = new THREE.Mesh(new THREE.ConeGeometry(p.body[1] * 1.5 * scale, p.body[2] * 0.5 * scale, 4), mat);
    tail.position.set(-p.body[2] * 0.7 * scale, p.legHeight * scale + p.body[1] * 0.5 * scale, 0);
    tail.rotation.z = Math.PI / 2;
    group.add(tail);
  }
  group.position.set(position[0], position[1], position[2]);
  group.userData.archdiscStudioPrimitive = true;
  group.userData.archdiscStudioPrimitiveKind = 'animal_' + preset;
  scene.add(group);
  return { ok: true, uuid: group.uuid, preset };
}
export function installAnimals() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioAnimalSpawn: _spawn,
    __studioAnimalListPresets: () => ({ ok: true, presets: Object.keys(_PRESETS) }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'foliage', 'Animal / wildlife templates');
  return { ok: true };
}
export default installAnimals;
