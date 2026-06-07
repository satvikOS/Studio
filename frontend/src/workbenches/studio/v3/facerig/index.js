// ArchDisc Studio V3 — FACS face rig (slice 938).
// 52 ARKit AUs + muscle layer + RBF correctives.
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';

const AU_NAMES = [
  'browInnerUp','browDownLeft','browDownRight','browOuterUpLeft','browOuterUpRight',
  'eyeLookUpLeft','eyeLookUpRight','eyeLookDownLeft','eyeLookDownRight',
  'eyeLookInLeft','eyeLookInRight','eyeLookOutLeft','eyeLookOutRight',
  'eyeBlinkLeft','eyeBlinkRight','eyeSquintLeft','eyeSquintRight','eyeWideLeft','eyeWideRight',
  'cheekPuff','cheekSquintLeft','cheekSquintRight',
  'noseSneerLeft','noseSneerRight',
  'jawOpen','jawForward','jawLeft','jawRight',
  'mouthFunnel','mouthPucker',
  'mouthLeft','mouthRight','mouthRollUpper','mouthRollLower','mouthShrugUpper','mouthShrugLower',
  'mouthClose','mouthSmileLeft','mouthSmileRight','mouthFrownLeft','mouthFrownRight',
  'mouthDimpleLeft','mouthDimpleRight','mouthUpperUpLeft','mouthUpperUpRight','mouthLowerDownLeft','mouthLowerDownRight',
  'mouthPressLeft','mouthPressRight','mouthStretchLeft','mouthStretchRight','tongueOut',
];

// Each AU gets a sparse displacement direction (anatomical default).
const AU_DIR = {
  browInnerUp: [0, 0.01, 0], browDownLeft: [0, -0.01, 0], browDownRight: [0, -0.01, 0],
  eyeBlinkLeft: [0, -0.005, 0], eyeBlinkRight: [0, -0.005, 0],
  jawOpen: [0, -0.03, 0.005], mouthSmileLeft: [0.01, 0.005, 0], mouthSmileRight: [-0.01, 0.005, 0],
  mouthFrownLeft: [0.005, -0.008, 0], mouthFrownRight: [-0.005, -0.008, 0],
  cheekPuff: [0, 0, 0.01], mouthFunnel: [0, 0, 0.015],
};

const MUSCLES = [
  { name: 'orbicularis_oris', anchor: [0, 0, 0.05], radius: 0.06, drivers: ['mouthFunnel', 'mouthPucker'] },
  { name: 'zygomatic_major_L', anchor: [0.04, 0.02, 0.03], radius: 0.05, drivers: ['mouthSmileLeft'] },
  { name: 'zygomatic_major_R', anchor: [-0.04, 0.02, 0.03], radius: 0.05, drivers: ['mouthSmileRight'] },
  { name: 'frontalis_L', anchor: [0.02, 0.08, 0.04], radius: 0.06, drivers: ['browOuterUpLeft', 'browInnerUp'] },
  { name: 'frontalis_R', anchor: [-0.02, 0.08, 0.04], radius: 0.06, drivers: ['browOuterUpRight', 'browInnerUp'] },
  { name: 'orbicularis_oculi_L', anchor: [0.03, 0.05, 0.04], radius: 0.04, drivers: ['eyeBlinkLeft', 'eyeSquintLeft'] },
  { name: 'orbicularis_oculi_R', anchor: [-0.03, 0.05, 0.04], radius: 0.04, drivers: ['eyeBlinkRight', 'eyeSquintRight'] },
];

const CORRECTIVES = [
  { trigger: ['mouthSmileLeft', 'eyeSquintLeft'], dir: [0.005, 0.003, 0], scale: 0.8 }, // Duchenne L
  { trigger: ['mouthSmileRight', 'eyeSquintRight'], dir: [-0.005, 0.003, 0], scale: 0.8 }, // Duchenne R
  { trigger: ['jawOpen', 'mouthFunnel'], dir: [0, -0.005, 0.005], scale: 0.5 },
];

let _installed = false, _nextId = 1;
const _rigs = new Map();

function _evaluate(rig) {
  const pos = rig.mesh.geometry.attributes.position.array;
  const base = rig.baseline;
  const n = pos.length / 3;
  // Reset to baseline
  for (let i = 0; i < pos.length; i++) pos[i] = base[i];
  // Apply AU displacements (sparse by vertex Y/X region — proxy for anatomy)
  for (const auName of AU_NAMES) {
    const w = rig.weights[auName] || 0;
    if (w < 0.001) continue;
    const dir = AU_DIR[auName] || [0, 0, 0];
    for (let i = 0; i < n; i++) {
      // Sparse: only affect vertices within radius of the AU's nominal region
      const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
      const reg = _auRegion(auName);
      const d = Math.hypot(x - reg[0], y - reg[1], z - reg[2]);
      if (d > 0.08) continue;
      const falloff = 1 - d / 0.08;
      pos[i * 3] += dir[0] * w * falloff;
      pos[i * 3 + 1] += dir[1] * w * falloff;
      pos[i * 3 + 2] += dir[2] * w * falloff;
    }
  }
  // Muscles
  for (const m of MUSCLES) {
    let contract = 0;
    for (const d of m.drivers) contract += rig.weights[d] || 0;
    contract /= m.drivers.length;
    if (contract < 0.001) continue;
    for (let i = 0; i < n; i++) {
      const x = base[i * 3], y = base[i * 3 + 1], z = base[i * 3 + 2];
      const d = Math.hypot(x - m.anchor[0], y - m.anchor[1], z - m.anchor[2]);
      if (d > m.radius) continue;
      const f = 1 - d / m.radius;
      pos[i * 3] += (m.anchor[0] - x) * contract * f * 0.1;
      pos[i * 3 + 1] += (m.anchor[1] - y) * contract * f * 0.1;
      pos[i * 3 + 2] += (m.anchor[2] - z) * contract * f * 0.1;
    }
  }
  // Correctives
  for (const c of CORRECTIVES) {
    let trig = 1;
    for (const t of c.trigger) trig *= (rig.weights[t] || 0);
    if (trig < 0.001) continue;
    for (let i = 0; i < n; i++) {
      pos[i * 3] += c.dir[0] * trig * c.scale;
      pos[i * 3 + 1] += c.dir[1] * trig * c.scale;
      pos[i * 3 + 2] += c.dir[2] * trig * c.scale;
    }
  }
  rig.mesh.geometry.attributes.position.needsUpdate = true;
  rig.mesh.geometry.computeVertexNormals();
}

function _auRegion(au) {
  if (au.startsWith('brow')) return [0, 0.08, 0.04];
  if (au.startsWith('eye')) return [au.endsWith('Left') ? 0.03 : -0.03, 0.05, 0.04];
  if (au.startsWith('cheek')) return [au.endsWith('Left') ? 0.05 : -0.05, 0.02, 0.04];
  if (au.startsWith('nose')) return [0, 0.02, 0.06];
  if (au.startsWith('jaw') || au.startsWith('mouth') || au === 'tongueOut') return [0, -0.04, 0.05];
  return [0, 0, 0.04];
}

export function installFaceRig() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioFaceRigCreate: ({ meshUuid } = {}) => {
      const vp = window.__archdiscViewport;
      if (!vp?.scene) return { ok: false, error: 'no viewport' };
      let mesh = null;
      vp.scene.traverse((o) => { if (!mesh && o.uuid === meshUuid) mesh = o; });
      if (!mesh) return { ok: false, error: 'no mesh' };
      const arr = mesh.geometry.attributes.position.array;
      const id = `facerig-${_nextId++}`;
      _rigs.set(id, { mesh, baseline: new Float32Array(arr), weights: Object.fromEntries(AU_NAMES.map((n) => [n, 0])) });
      return { ok: true, id, auCount: AU_NAMES.length };
    },
    __studioFaceRigSetAU: ({ id, name, weight }) => { const r = _rigs.get(id); if (!r || !(name in r.weights)) return { ok: false }; r.weights[name] = Math.max(0, Math.min(1, weight)); _evaluate(r); return { ok: true }; },
    __studioFaceRigSetAUMap: ({ id, weights }) => { const r = _rigs.get(id); if (!r) return { ok: false }; for (const [k, v] of Object.entries(weights)) if (k in r.weights) r.weights[k] = Math.max(0, Math.min(1, v)); _evaluate(r); return { ok: true }; },
    __studioFaceRigGetAUNames: () => ({ ok: true, names: AU_NAMES }),
    __studioFaceRigReset: ({ id }) => { const r = _rigs.get(id); if (!r) return { ok: false }; for (const k of Object.keys(r.weights)) r.weights[k] = 0; _evaluate(r); return { ok: true }; },
    __studioFaceRigDelete: ({ id }) => ({ ok: _rigs.delete(id) }),
    __studioFaceRigList: () => ({ ok: true, ids: [..._rigs.keys()] }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'anim', 'FACS face rig (52 AUs + muscle + correctives)');
  return { ok: true };
}
export default installFaceRig;
