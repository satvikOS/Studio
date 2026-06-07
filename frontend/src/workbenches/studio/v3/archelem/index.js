// ArchDisc Studio V3 — parametric architectural elements (slice 838).
// Stairs / doors / windows with editable param blobs. Revit / Archicad
// component parity for arch-vis pipelines.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
function _stairs({ steps = 10, stepWidth = 0.04, stepHeight = 0.005, stepDepth = 0.01 } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb8a070, roughness: 0.8 });
  for (let i = 0; i < steps; i++) {
    const geom = new THREE.BoxGeometry(stepWidth, stepHeight, stepDepth);
    const step = new THREE.Mesh(geom, mat);
    step.position.set(0, i * stepHeight, i * stepDepth);
    group.add(step);
  }
  group.userData.archdiscStudioPrimitive = true;
  group.userData.archdiscStudioPrimitiveKind = 'stairs';
  group.userData.archdiscStudioArchParams = { kind: 'stairs', steps, stepWidth, stepHeight, stepDepth };
  scene.add(group);
  return { ok: true, uuid: group.uuid, steps };
}
function _door({ width = 0.03, height = 0.06, thickness = 0.003, frameThickness = 0.002 } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const group = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6c4830, roughness: 0.7 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(width, height, thickness), wood);
  door.position.set(0, height / 2, 0);
  group.add(door);
  const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a3018, roughness: 0.7 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(width + 2 * frameThickness, frameThickness, thickness * 1.5), frameMat);
  top.position.set(0, height + frameThickness / 2, 0);
  group.add(top);
  const left = new THREE.Mesh(new THREE.BoxGeometry(frameThickness, height, thickness * 1.5), frameMat);
  left.position.set(-width / 2 - frameThickness / 2, height / 2, 0);
  group.add(left);
  const right = left.clone();
  right.position.x = width / 2 + frameThickness / 2;
  group.add(right);
  group.userData.archdiscStudioPrimitive = true;
  group.userData.archdiscStudioPrimitiveKind = 'door';
  group.userData.archdiscStudioArchParams = { kind: 'door', width, height, thickness, frameThickness };
  scene.add(group);
  return { ok: true, uuid: group.uuid };
}
function _window({ width = 0.04, height = 0.05, thickness = 0.003, paneCount = 4 } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const group = new THREE.Group();
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xa0c0e0, transparent: true, opacity: 0.3, transmission: 0.85, roughness: 0.05 });
  const frame = new THREE.MeshStandardMaterial({ color: 0xd0d0c8, roughness: 0.5 });
  const cols = Math.max(1, Math.floor(Math.sqrt(paneCount)));
  const rows = Math.ceil(paneCount / cols);
  const pw = width / cols, ph = height / rows;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const pane = new THREE.Mesh(new THREE.BoxGeometry(pw * 0.85, ph * 0.85, thickness), glass);
      pane.position.set(-width / 2 + pw / 2 + c * pw, height / 2 - ph / 2 + (rows - 1 - r) * ph, 0);
      group.add(pane);
    }
  }
  // Outer frame
  const outer = new THREE.Mesh(new THREE.BoxGeometry(width + 0.004, height + 0.004, thickness * 1.2), frame);
  outer.position.set(0, height / 2, -thickness * 0.6);
  group.add(outer);
  group.userData.archdiscStudioPrimitive = true;
  group.userData.archdiscStudioPrimitiveKind = 'window';
  group.userData.archdiscStudioArchParams = { kind: 'window', width, height, thickness, paneCount };
  scene.add(group);
  return { ok: true, uuid: group.uuid };
}
export function installArchElem() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioArchStairs: _stairs,
    __studioArchDoor: _door,
    __studioArchWindow: _window,
    __studioArchListKinds: () => ({ ok: true, kinds: ['stairs', 'door', 'window'] }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'arch', 'Parametric architectural elements');
  return { ok: true };
}
export default installArchElem;
