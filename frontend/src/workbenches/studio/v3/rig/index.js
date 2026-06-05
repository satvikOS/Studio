// ArchDisc Studio V3 — rigging public installer.
//
// `installRigging()` binds every rig op to `window.__studioRig*` and
// registers each with `window.__studioCommandRegister` under category
// 'rig' so the command palette discovers them. Idempotent — re-calls
// no-op (guarded by window.__studioRigInstalled).
//
// The autoloader (rig/autoload.js) calls this on import; api.js gets
// `import('./rig/autoload.js')` wired in by the orchestrator. We
// deliberately don't touch api.js / StudioShellV3.jsx ourselves.

import {
  createArmature,
  addBone,
  listBones,
  getBone,
  setBoneRotation,
  removeArmature,
} from './armature.js';
import { bindMeshToArmature } from './skin.js';
import { solveIK } from './ik.js';
import { showSkeletonHelper, hideSkeletonHelper } from './helpers.js';
import { registerOp } from '../common/registry.js';

function reg(name, fn, description) {
  registerOp(name, fn, 'rig', description);
}

export function installRigging() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (window.__studioRigInstalled) return { ok: true, alreadyInstalled: true };
  window.__studioRigInstalled = true;

  reg('__studioRigCreateArmature', (opts) => createArmature(opts || {}),
    'Create a new bone-hierarchy armature (Group + root Bone).');
  reg('__studioRigAddBone', (armUuid, parentBoneUuid, offsetXYZ, name) =>
    addBone(armUuid, parentBoneUuid, offsetXYZ, name),
    'Add a Bone under an armature, parented to root or to another bone.');
  reg('__studioRigListBones', (armUuid) => listBones(armUuid),
    'List every bone under an armature with position/rotation/length.');
  reg('__studioRigGetBone', (boneUuid) => getBone(boneUuid),
    'Read a single bone — local & world position, Euler rotation, length.');
  reg('__studioRigSetBoneRotation', (boneUuid, eulerXYZ) =>
    setBoneRotation(boneUuid, eulerXYZ),
    'Set a bone\'s local Euler rotation (radians); deforms any bound SkinnedMesh.');
  reg('__studioRigRemoveArmature', (armUuid) => removeArmature(armUuid),
    'Remove an armature; bound SkinnedMeshes revert to plain Meshes.');
  reg('__studioRigBindMesh', (meshUuid, armUuid, opts) =>
    bindMeshToArmature(meshUuid, armUuid, opts || {}),
    'Bind a Mesh to an armature as a SkinnedMesh (closest-bone weights).');
  reg('__studioRigShowSkeleton', (armUuid) => showSkeletonHelper(armUuid),
    'Show the SkeletonHelper gizmo for an armature.');
  reg('__studioRigHideSkeleton', (armUuid) => hideSkeletonHelper(armUuid),
    'Hide the SkeletonHelper gizmo for an armature.');
  reg('__studioRigSolveIK', (effectorBoneUuid, targetWorldPos, iters, chain) =>
    solveIK(effectorBoneUuid, targetWorldPos, iters, chain),
    'CCD IK: rotate the chain so the effector bone reaches a world-space target.');

  return { ok: true, alreadyInstalled: false };
}

export function uninstallRigging() {
  if (typeof window === 'undefined') return { ok: false };
  for (const k of [
    '__studioRigCreateArmature', '__studioRigAddBone', '__studioRigListBones',
    '__studioRigGetBone', '__studioRigSetBoneRotation', '__studioRigRemoveArmature',
    '__studioRigBindMesh', '__studioRigShowSkeleton', '__studioRigHideSkeleton',
    '__studioRigSolveIK',
  ]) {
    try { delete window[k]; } catch (_) {}
    if (typeof window.__studioCommandUnregister === 'function') {
      try { window.__studioCommandUnregister(k); } catch (_) {}
    }
  }
  window.__studioRigInstalled = false;
  return { ok: true };
}
