// ArchDisc Studio V3 — facial blendshape editor (slice 815).
// Maya Shape Editor / Unreal Morph Target equivalent. Stores per-mesh
// blendshape deltas + a 52-shape FACS preset library (ARKit blendshape
// set used by every modern facial-rig pipeline).

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
const _state = new Map(); // uuid → {basePositions, blendshapes: {name: {delta, weight}}}
const ARKIT_BLENDSHAPES = [
  'browDownLeft','browDownRight','browInnerUp','browOuterUpLeft','browOuterUpRight',
  'cheekPuff','cheekSquintLeft','cheekSquintRight','eyeBlinkLeft','eyeBlinkRight',
  'eyeLookDownLeft','eyeLookDownRight','eyeLookInLeft','eyeLookInRight',
  'eyeLookOutLeft','eyeLookOutRight','eyeLookUpLeft','eyeLookUpRight',
  'eyeSquintLeft','eyeSquintRight','eyeWideLeft','eyeWideRight','jawForward',
  'jawLeft','jawOpen','jawRight','mouthClose','mouthDimpleLeft','mouthDimpleRight',
  'mouthFrownLeft','mouthFrownRight','mouthFunnel','mouthLeft','mouthLowerDownLeft',
  'mouthLowerDownRight','mouthPressLeft','mouthPressRight','mouthPucker','mouthRight',
  'mouthRollLower','mouthRollUpper','mouthShrugLower','mouthShrugUpper',
  'mouthSmileLeft','mouthSmileRight','mouthStretchLeft','mouthStretchRight',
  'mouthUpperUpLeft','mouthUpperUpRight','noseSneerLeft','noseSneerRight','tongueOut',
];
function _ensure(meshUuid) {
  const scene = window.__archdiscScene; if (!scene) return null;
  const m = scene.getObjectByProperty('uuid', meshUuid); if (!m?.geometry) return null;
  let s = _state.get(meshUuid);
  if (!s) {
    const pos = m.geometry.attributes.position;
    const base = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) { base[i*3]=pos.getX(i); base[i*3+1]=pos.getY(i); base[i*3+2]=pos.getZ(i); }
    s = { mesh: m, basePositions: base, blendshapes: {} };
    _state.set(meshUuid, s);
  }
  return s;
}
function _recompose(s) {
  const pos = s.mesh.geometry.attributes.position;
  const out = new Float32Array(s.basePositions);
  for (const { delta, weight } of Object.values(s.blendshapes)) {
    if (!weight) continue;
    for (let i = 0; i < out.length; i++) out[i] += delta[i] * weight;
  }
  for (let i = 0; i < pos.count; i++) pos.setXYZ(i, out[i*3], out[i*3+1], out[i*3+2]);
  pos.needsUpdate = true;
  s.mesh.geometry.computeVertexNormals();
}
export function installFaceBlend() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioFaceBlendCreate: ({ meshUuid, name, deltaPositions } = {}) => {
      const s = _ensure(meshUuid); if (!s) return { ok: false };
      const delta = new Float32Array(s.basePositions.length);
      if (deltaPositions && deltaPositions.length === delta.length) delta.set(deltaPositions);
      s.blendshapes[name] = { delta, weight: 0 };
      return { ok: true };
    },
    __studioFaceBlendCapture: ({ meshUuid, name } = {}) => {
      const s = _ensure(meshUuid); if (!s) return { ok: false };
      const pos = s.mesh.geometry.attributes.position;
      const delta = new Float32Array(s.basePositions.length);
      for (let i = 0; i < pos.count; i++) {
        delta[i*3]   = pos.getX(i) - s.basePositions[i*3];
        delta[i*3+1] = pos.getY(i) - s.basePositions[i*3+1];
        delta[i*3+2] = pos.getZ(i) - s.basePositions[i*3+2];
      }
      s.blendshapes[name] = { delta, weight: 0 };
      return { ok: true, vertCount: pos.count };
    },
    __studioFaceBlendSetWeight: ({ meshUuid, name, weight } = {}) => {
      const s = _state.get(meshUuid); if (!s?.blendshapes[name]) return { ok: false };
      s.blendshapes[name].weight = Number(weight) || 0;
      _recompose(s);
      return { ok: true };
    },
    __studioFaceBlendList: ({ meshUuid } = {}) => {
      const s = _state.get(meshUuid); if (!s) return { ok: false };
      return { ok: true, names: Object.keys(s.blendshapes), weights: Object.fromEntries(Object.entries(s.blendshapes).map(([n,b]) => [n,b.weight])) };
    },
    __studioFaceBlendDelete: ({ meshUuid, name } = {}) => {
      const s = _state.get(meshUuid); if (!s) return { ok: false };
      delete s.blendshapes[name]; _recompose(s);
      return { ok: true };
    },
    __studioFaceBlendARKitNames: () => ({ ok: true, names: ARKIT_BLENDSHAPES.slice() }),
    __studioFaceBlendReset: ({ meshUuid } = {}) => {
      const s = _state.get(meshUuid); if (!s) return { ok: false };
      for (const b of Object.values(s.blendshapes)) b.weight = 0;
      _recompose(s);
      return { ok: true };
    },
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'anim', 'Facial blendshape editor (ARKit-52 set)');
  return { ok: true };
}
export default installFaceBlend;
