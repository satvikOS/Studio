// ArchDisc Studio V3 — auto-rig HumanIK biped (slice 813).
import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
const BONE_NAMES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'L_Shoulder', 'L_Arm', 'L_Forearm', 'L_Hand',
  'R_Shoulder', 'R_Arm', 'R_Forearm', 'R_Hand',
  'L_UpLeg', 'L_Leg', 'L_Foot', 'L_Toe',
  'R_UpLeg', 'R_Leg', 'R_Foot', 'R_Toe',
  'Root',
];
function _bonePositions(bbox) {
  const cy = (bbox.min.y + bbox.max.y) / 2;
  const h = bbox.max.y - bbox.min.y;
  const halfW = (bbox.max.x - bbox.min.x) / 2;
  const headY = bbox.max.y - h * 0.05;
  const neckY = bbox.max.y - h * 0.15;
  const spineTop = bbox.max.y - h * 0.3;
  const spine = (cy + bbox.max.y) / 2;
  const hipsY = bbox.min.y + h * 0.5;
  const kneeY = bbox.min.y + h * 0.25;
  const footY = bbox.min.y + 0.01;
  return {
    Root: [0, hipsY, 0],
    Hips: [0, hipsY, 0],
    Spine: [0, spine, 0],
    Spine1: [0, spineTop, 0],
    Spine2: [0, neckY, 0],
    Neck: [0, neckY, 0],
    Head: [0, headY, 0],
    L_Shoulder: [halfW * 0.6, spineTop, 0],
    L_Arm: [halfW * 0.8, spineTop - h * 0.05, 0],
    L_Forearm: [halfW * 1.0, cy, 0],
    L_Hand: [halfW * 1.0, hipsY + h * 0.05, 0],
    R_Shoulder: [-halfW * 0.6, spineTop, 0],
    R_Arm: [-halfW * 0.8, spineTop - h * 0.05, 0],
    R_Forearm: [-halfW * 1.0, cy, 0],
    R_Hand: [-halfW * 1.0, hipsY + h * 0.05, 0],
    L_UpLeg: [halfW * 0.4, hipsY, 0],
    L_Leg: [halfW * 0.4, kneeY, 0],
    L_Foot: [halfW * 0.4, footY, 0],
    L_Toe: [halfW * 0.4, footY, halfW * 0.3],
    R_UpLeg: [-halfW * 0.4, hipsY, 0],
    R_Leg: [-halfW * 0.4, kneeY, 0],
    R_Foot: [-halfW * 0.4, footY, 0],
    R_Toe: [-halfW * 0.4, footY, halfW * 0.3],
  };
}
function _build({ meshUuid, opts = {} } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh?.geometry) return { ok: false, error: 'no mesh' };
  mesh.geometry.computeBoundingBox();
  const bbox = mesh.geometry.boundingBox;
  const positions = _bonePositions(bbox);
  const arm = new THREE.Group();
  arm.userData.archdiscStudioPrimitive = true;
  arm.userData.archdiscStudioPrimitiveKind = 'autorig';
  arm.name = 'AutoRigArmature';
  for (const name of BONE_NAMES) {
    const bone = new THREE.Bone();
    bone.name = name;
    const p = positions[name];
    if (p) bone.position.set(p[0], p[1], p[2]);
    bone.userData.archdiscStudioBone = true;
    arm.add(bone);
  }
  scene.add(arm);
  return { ok: true, armatureUuid: arm.uuid, boneCount: BONE_NAMES.length };
}
export function installAutoRig() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioAutoRigBuild: _build,
    __studioAutoRigListBoneNames: () => ({ ok: true, names: BONE_NAMES.slice() }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rig', 'HumanIK auto-rig');
  return { ok: true };
}
export default installAutoRig;
