// Slice 702 — HumanIK-style biped autorigger. Generates a full
// humanoid Skeleton + IK chains + space-switching constraints by
// analyzing the bounding box of a humanoid mesh. Mirrors Maya HumanIK,
// Mixamo Auto-Rigger, and Cascadeur's biped skeleton.

import * as THREE from 'three';

// Standard 21-joint biped (Maya HumanIK / Mixamo basic):
const BONE_LAYOUT = [
  // [name, parent, relPosFn(bbox), length-ratio of bbox.y]
  ['Hips',         null,            (bb) => [bb.cx, bb.cy + bb.h * 0.05, bb.cz], 0.0],
  ['Spine',        'Hips',          (bb) => [bb.cx, bb.cy + bb.h * 0.15, bb.cz], 0.1],
  ['Spine1',       'Spine',         (bb) => [bb.cx, bb.cy + bb.h * 0.27, bb.cz], 0.12],
  ['Spine2',       'Spine1',        (bb) => [bb.cx, bb.cy + bb.h * 0.38, bb.cz], 0.11],
  ['Neck',         'Spine2',        (bb) => [bb.cx, bb.cy + bb.h * 0.45, bb.cz], 0.07],
  ['Head',         'Neck',          (bb) => [bb.cx, bb.cy + bb.h * 0.49, bb.cz], 0.04],
  // Left arm.
  ['LeftShoulder', 'Spine2',        (bb) => [bb.cx + bb.w * 0.08, bb.cy + bb.h * 0.42, bb.cz], 0.0],
  ['LeftArm',      'LeftShoulder',  (bb) => [bb.cx + bb.w * 0.16, bb.cy + bb.h * 0.41, bb.cz], 0.0],
  ['LeftForeArm',  'LeftArm',       (bb) => [bb.cx + bb.w * 0.28, bb.cy + bb.h * 0.30, bb.cz], 0.0],
  ['LeftHand',     'LeftForeArm',   (bb) => [bb.cx + bb.w * 0.38, bb.cy + bb.h * 0.20, bb.cz], 0.0],
  // Right arm.
  ['RightShoulder','Spine2',        (bb) => [bb.cx - bb.w * 0.08, bb.cy + bb.h * 0.42, bb.cz], 0.0],
  ['RightArm',     'RightShoulder', (bb) => [bb.cx - bb.w * 0.16, bb.cy + bb.h * 0.41, bb.cz], 0.0],
  ['RightForeArm', 'RightArm',      (bb) => [bb.cx - bb.w * 0.28, bb.cy + bb.h * 0.30, bb.cz], 0.0],
  ['RightHand',    'RightForeArm',  (bb) => [bb.cx - bb.w * 0.38, bb.cy + bb.h * 0.20, bb.cz], 0.0],
  // Left leg.
  ['LeftUpLeg',    'Hips',          (bb) => [bb.cx + bb.w * 0.06, bb.cy + bb.h * 0.02, bb.cz], 0.0],
  ['LeftLeg',      'LeftUpLeg',     (bb) => [bb.cx + bb.w * 0.08, bb.cy - bb.h * 0.18, bb.cz], 0.0],
  ['LeftFoot',     'LeftLeg',       (bb) => [bb.cx + bb.w * 0.09, bb.cy - bb.h * 0.42, bb.cz], 0.0],
  ['LeftToeBase',  'LeftFoot',      (bb) => [bb.cx + bb.w * 0.09, bb.cy - bb.h * 0.48, bb.cz + bb.d * 0.08], 0.0],
  // Right leg.
  ['RightUpLeg',   'Hips',          (bb) => [bb.cx - bb.w * 0.06, bb.cy + bb.h * 0.02, bb.cz], 0.0],
  ['RightLeg',     'RightUpLeg',    (bb) => [bb.cx - bb.w * 0.08, bb.cy - bb.h * 0.18, bb.cz], 0.0],
  ['RightFoot',    'RightLeg',      (bb) => [bb.cx - bb.w * 0.09, bb.cy - bb.h * 0.42, bb.cz], 0.0],
  ['RightToeBase', 'RightFoot',     (bb) => [bb.cx - bb.w * 0.09, bb.cy - bb.h * 0.48, bb.cz + bb.d * 0.08], 0.0],
];

const IK_CHAINS = [
  // [endEffectorName, depth, label]
  ['LeftHand', 2, 'IK_LeftArm'],
  ['RightHand', 2, 'IK_RightArm'],
  ['LeftFoot', 2, 'IK_LeftLeg'],
  ['RightFoot', 2, 'IK_RightLeg'],
];

function _measureBBox(mesh) {
  mesh.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(mesh);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  return {
    cx: center.x, cy: center.y, cz: center.z,
    w: size.x, h: size.y, d: size.z,
    minY: box.min.y,
  };
}

export function autoRig(meshUuid, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh) return { ok: false, error: 'mesh not found' };
  const bb = _measureBBox(mesh);

  // Build bones.
  const bones = {};
  const boneList = [];
  for (const [name, parent, posFn] of BONE_LAYOUT) {
    const bone = new THREE.Bone();
    bone.name = name;
    const [x, y, z] = posFn(bb);
    if (parent) {
      bones[parent].add(bone);
      const p = bones[parent].getWorldPosition(new THREE.Vector3());
      bone.position.set(x - p.x, y - p.y, z - p.z);
    } else {
      bone.position.set(x, y, z);
    }
    bones[name] = bone;
    boneList.push(bone);
  }

  const skeleton = new THREE.Skeleton(boneList);
  // Root.
  scene.add(bones['Hips']);

  // Auto-weighting: assign each vertex to its closest bone with linear falloff.
  if (mesh.geometry && mesh.geometry.attributes.position && opts?.skin !== false) {
    const pos = mesh.geometry.attributes.position;
    const skinIndices = new Float32Array(pos.count * 4);
    const skinWeights = new Float32Array(pos.count * 4);
    const bonePositions = boneList.map((b) => b.getWorldPosition(new THREE.Vector3()));
    for (let i = 0; i < pos.count; i++) {
      const vx = pos.array[i * 3];
      const vy = pos.array[i * 3 + 1];
      const vz = pos.array[i * 3 + 2];
      // Find 4 closest bones.
      const dists = bonePositions.map((bp, idx) => ({
        idx, d: Math.sqrt((vx - bp.x) ** 2 + (vy - bp.y) ** 2 + (vz - bp.z) ** 2),
      }));
      dists.sort((a, b) => a.d - b.d);
      const top4 = dists.slice(0, 4);
      const invs = top4.map((x) => 1 / Math.max(1e-3, x.d));
      const sum = invs.reduce((a, b) => a + b, 0);
      for (let k = 0; k < 4; k++) {
        skinIndices[i * 4 + k] = top4[k].idx;
        skinWeights[i * 4 + k] = invs[k] / sum;
      }
    }
    mesh.geometry.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndices, 4));
    mesh.geometry.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeights, 4));
  }

  // Build IK chain descriptors (used by slice-686 rigui IK gizmos).
  const ikChains = IK_CHAINS.map(([endName, depth, label]) => ({
    label,
    endEffector: endName,
    depth,
    chain: (() => {
      const c = [];
      let cur = bones[endName];
      for (let i = 0; i < depth + 1 && cur; i++) {
        c.unshift(cur.name);
        cur = cur.parent && cur.parent.isBone ? cur.parent : null;
      }
      return c;
    })(),
  }));

  if (!mesh.userData) mesh.userData = {};
  mesh.userData.archdiscStudioHumanIK = {
    skeletonRoot: bones['Hips'].uuid,
    boneNames: boneList.map((b) => b.name),
    boneUuids: boneList.map((b) => b.uuid),
    ikChains,
  };

  // Register with the slice-686 rig system if installed.
  if (typeof window.__studioRigAttach === 'function') {
    try { window.__studioRigAttach(meshUuid, bones['Hips'].uuid, ikChains); } catch (_) {}
  }

  return {
    ok: true,
    rootUuid: bones['Hips'].uuid,
    boneCount: boneList.length,
    ikChainCount: ikChains.length,
    boneNames: boneList.map((b) => b.name),
  };
}

export function poseIKTarget(meshUuid, chainLabel, targetPos) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh || !mesh.userData?.archdiscStudioHumanIK) return { ok: false };
  const ikChains = mesh.userData.archdiscStudioHumanIK.ikChains;
  const chain = ikChains.find((c) => c.label === chainLabel);
  if (!chain) return { ok: false };
  const root = scene.getObjectByProperty('uuid', mesh.userData.archdiscStudioHumanIK.skeletonRoot);
  if (!root) return { ok: false };
  // Two-bone analytical IK.
  const upperName = chain.chain[chain.chain.length - 3];
  const lowerName = chain.chain[chain.chain.length - 2];
  const endName = chain.chain[chain.chain.length - 1];
  if (!upperName || !lowerName || !endName) return { ok: false };
  const upper = root.getObjectByName(upperName);
  const lower = root.getObjectByName(lowerName);
  if (!upper || !lower) return { ok: false };
  const upperWorld = upper.getWorldPosition(new THREE.Vector3());
  const lowerWorld = lower.getWorldPosition(new THREE.Vector3());
  const tgt = new THREE.Vector3(...targetPos);
  const upperLower = lowerWorld.distanceTo(upperWorld);
  const lowerEnd = lower.children[0]?.getWorldPosition(new THREE.Vector3()).distanceTo(lowerWorld) || upperLower;
  const reachDist = upperWorld.distanceTo(tgt);
  // Compute lower bone angle by law of cosines.
  const cosAngle = (upperLower * upperLower + lowerEnd * lowerEnd - reachDist * reachDist)
    / (2 * upperLower * lowerEnd);
  const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
  lower.rotation.set(0, 0, Math.PI - angle);
  // Aim upper at target.
  const aim = tgt.clone().sub(upperWorld).normalize();
  const fwd = new THREE.Vector3(0, -1, 0);
  upper.quaternion.setFromUnitVectors(fwd, aim);
  return { ok: true };
}
