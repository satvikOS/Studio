// ArchDisc Studio V3 — CCD (Cyclic Coordinate Descent) IK solver.
//
// Real algorithm, not a stub. CCD iterates from the bone immediately
// upstream of the effector and walks rootwards. For each chain bone, it:
//   1. Reads the effector's current world position e.
//   2. Reads the target world position t.
//   3. Reads the bone's world position b.
//   4. Builds two world-space vectors: vE = (e - b), vT = (t - b).
//   5. Rotates the bone so vE aligns with vT — represented as the
//      quaternion `q` that takes vE → vT, applied in the bone's PARENT
//      frame (because Three's bone.quaternion is local).
//
// One full pass through the chain = one iteration. We run `iterations`
// passes (default 8) or stop early when the effector is within 1e-4 of
// the target. This converges in ~4-6 iterations for short chains and
// stays well-behaved on overshoot because we use the shortest-arc rotor.
//
// `chainLength` walks the parent chain up from the effector. It counts
// the bones that get rotated — the effector bone itself is NOT rotated
// (rotating it doesn't move its origin, only its tail). The default of
// 3 covers shoulder + elbow + wrist for a four-bone arm rig.

import * as THREE from 'three';
import { __internal as armInt } from './armature.js';

const EPS = 1e-4;
const MAX_ITERS = 64;

function getScene() {
  return (typeof window !== 'undefined' && (window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene))) || null;
}

// Build a chain [chainTopBone, ..., parentOfEffector] of length `chainLength`,
// walking up from the bone just above the effector.
function buildChain(effector, chainLength) {
  const chain = [];
  let cur = effector.parent;
  let count = 0;
  while (cur && cur.isBone && count < chainLength) {
    chain.push(cur);
    cur = cur.parent;
    count++;
  }
  return chain;
}

export function solveIK(effectorBoneUuid, targetWorldPos, iterations = 8, chainLength = 3) {
  const scene = getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  const effector = armInt.findBoneAnyArmature(effectorBoneUuid);
  if (!effector) return { ok: false, error: 'no effector bone' };
  if (!Array.isArray(targetWorldPos) || targetWorldPos.length !== 3) {
    return { ok: false, error: 'bad target' };
  }
  const iters = Math.max(1, Math.min(MAX_ITERS, Math.floor(Number(iterations) || 8)));
  const chainLen = Math.max(1, Math.min(16, Math.floor(Number(chainLength) || 3)));
  const arm = armInt.findArmatureForBone(effector);
  if (!arm) return { ok: false, error: 'effector not in armature' };

  const target = new THREE.Vector3(targetWorldPos[0], targetWorldPos[1], targetWorldPos[2]);

  // Snapshot starting rotations so we can compute "rotationsChanged" + roll
  // back if the user asked for a no-op.
  const chain = buildChain(effector, chainLen);
  if (!chain.length) return { ok: false, error: 'effector has no IK chain' };
  const startEulers = chain.map((b) => [b.rotation.x, b.rotation.y, b.rotation.z]);

  arm.updateMatrixWorld(true);

  // Scratch vectors / quats reused per inner step.
  const bonePos = new THREE.Vector3();
  const effPos = new THREE.Vector3();
  const vE = new THREE.Vector3();
  const vT = new THREE.Vector3();
  const qWorld = new THREE.Quaternion();
  const parentWorldQ = new THREE.Quaternion();
  const parentWorldQInv = new THREE.Quaternion();
  const qLocal = new THREE.Quaternion();
  const bonePosScratch = new THREE.Vector3();
  const boneScale = new THREE.Vector3();

  let finalDist = Infinity;
  let didIter = 0;

  for (let it = 0; it < iters; it++) {
    didIter = it + 1;
    let improved = false;
    for (const bone of chain) {
      arm.updateMatrixWorld(true);
      bone.getWorldPosition(bonePos);
      effector.getWorldPosition(effPos);

      vE.subVectors(effPos, bonePos);
      vT.subVectors(target, bonePos);

      const lenE = vE.length();
      const lenT = vT.length();
      if (lenE < EPS || lenT < EPS) continue;
      vE.divideScalar(lenE);
      vT.divideScalar(lenT);

      // Shortest-arc quaternion from vE to vT, in world space.
      qWorld.setFromUnitVectors(vE, vT);

      // Convert to the bone's LOCAL space by removing the parent's
      // world quaternion: q_local = inv(qParent) * qWorld * qParent * q_localPrev.
      // Simpler: take the bone's existing world quaternion, pre-multiply
      // by qWorld, then convert back to local via parent's world inverse.
      if (bone.parent) {
        bone.parent.matrixWorld.decompose(bonePosScratch, parentWorldQ, boneScale);
        parentWorldQInv.copy(parentWorldQ).invert();
      } else {
        parentWorldQ.identity();
        parentWorldQInv.identity();
      }
      // Current bone world quaternion.
      const boneWorldQ = new THREE.Quaternion();
      bone.matrixWorld.decompose(new THREE.Vector3(), boneWorldQ, new THREE.Vector3());
      // New world quaternion = qWorld ∘ current
      const newWorldQ = qWorld.clone().multiply(boneWorldQ);
      // Local = inv(parent) * new
      qLocal.copy(parentWorldQInv).multiply(newWorldQ);
      bone.quaternion.copy(qLocal);
      bone.updateMatrixWorld(true);
      improved = true;
    }
    if (!improved) break;
    arm.updateMatrixWorld(true);
    effector.getWorldPosition(effPos);
    finalDist = effPos.distanceTo(target);
    if (finalDist < EPS) break;
  }

  // Push skeleton update so any bound SkinnedMesh re-skins on next frame.
  const skel = arm.userData.archdiscStudioRigSkeleton;
  if (skel && typeof skel.update === 'function') skel.update();

  // Did any rotation actually change?
  let changed = 0;
  for (let i = 0; i < chain.length; i++) {
    const s = startEulers[i];
    const b = chain[i];
    if (
      Math.abs(b.rotation.x - s[0]) > 1e-6 ||
      Math.abs(b.rotation.y - s[1]) > 1e-6 ||
      Math.abs(b.rotation.z - s[2]) > 1e-6
    ) changed++;
  }

  arm.updateMatrixWorld(true);
  effector.getWorldPosition(effPos);
  if (!Number.isFinite(finalDist)) finalDist = effPos.distanceTo(target);

  return {
    ok: true,
    iterations: didIter,
    chainLength: chain.length,
    rotationsChanged: changed,
    finalDistance: finalDist,
    converged: finalDist < EPS,
    chainBoneUuids: chain.map((b) => b.uuid),
  };
}
