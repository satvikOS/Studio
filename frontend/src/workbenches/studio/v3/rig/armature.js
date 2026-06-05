// ArchDisc Studio V3 — armature (bone-hierarchy) primitives.
//
// Real rigging support, parity with Blender / Maya's basic armature
// workflow. An armature is a Three.Object3D root holding a Three.Bone
// tree plus the Three.Skeleton built from every bone in the tree.
// `setBoneRotation` mutates the bone's Euler; `THREE.Skeleton.update()`
// is called by the renderer through the SkinnedMesh — but we also
// explicitly recompute world matrices so listBones / getBone return
// fresh world-space transforms before the next render tick.
//
// Persisted on the armature root via userData:
//   archdiscStudioRigArmature : true      (marker)
//   archdiscStudioRigSkeleton : THREE.Skeleton
//   archdiscStudioRigBones    : Map<uuid, THREE.Bone>
//   archdiscStudioRigRoot     : THREE.Bone (the topmost bone, child of root)
//   archdiscStudioRigHelper   : THREE.SkeletonHelper | null (helpers.js fills)
//
// All exports are pure (take a scene/uuid, never reach into window
// implicitly) so the autoloader can bind them straight to window.__studioRig*.

import * as THREE from 'three';

const ARM_TAG = 'archdiscStudioRigArmature';
const BONE_TAG = 'archdiscStudioRigBone';

function getScene() {
  return (typeof window !== 'undefined' && (window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene))) || null;
}

function findArmature(armUuid) {
  const scene = getScene();
  if (!scene) return null;
  let arm = null;
  scene.traverse((o) => {
    if (!arm && o.userData && o.userData[ARM_TAG] && o.uuid === armUuid) arm = o;
  });
  return arm;
}

function findBoneInArmature(arm, boneUuid) {
  if (!arm) return null;
  let bone = null;
  arm.traverse((o) => {
    if (bone) return;
    if (o.isBone && o.uuid === boneUuid) bone = o;
  });
  return bone;
}

function findBoneAnyArmature(boneUuid) {
  const scene = getScene();
  if (!scene) return null;
  let bone = null;
  scene.traverse((o) => {
    if (bone) return;
    if (o.isBone && o.uuid === boneUuid) bone = o;
  });
  return bone;
}

function findArmatureForBone(bone) {
  let cur = bone;
  while (cur) {
    if (cur.userData && cur.userData[ARM_TAG]) return cur;
    cur = cur.parent;
  }
  return null;
}

// Compose / rebuild the Skeleton for an armature from every bone in its
// subtree (in deterministic traversal order). Stored on the armature's
// userData so SkinnedMesh.bind(...) can reach it from skin.js.
function rebuildSkeleton(arm) {
  if (!arm) return null;
  const bones = [];
  arm.traverse((o) => { if (o.isBone) bones.push(o); });
  // Dispose any prior skeleton's bone matrices texture so the GPU isn't
  // leaking — Three.Skeleton.dispose was added in r147; guard it.
  const prior = arm.userData && arm.userData.archdiscStudioRigSkeleton;
  if (prior && typeof prior.dispose === 'function') {
    try { prior.dispose(); } catch (_) { /* fine — pre-r147 */ }
  }
  const skel = new THREE.Skeleton(bones);
  arm.userData.archdiscStudioRigSkeleton = skel;
  // Cache uuid → bone map (rebuilt on every add/remove).
  const map = new Map();
  for (const b of bones) map.set(b.uuid, b);
  arm.userData.archdiscStudioRigBones = map;
  // If a SkinnedMesh is already bound to this armature, re-bind so it
  // picks up the fresh skeleton (the bone count may have changed).
  const scene = getScene();
  if (scene) {
    scene.traverse((o) => {
      if (o.isSkinnedMesh && o.userData && o.userData.archdiscStudioRigArmatureUuid === arm.uuid) {
        o.bind(skel, o.bindMatrix);
      }
    });
  }
  arm.updateMatrixWorld(true);
  return skel;
}

// ─── public ──────────────────────────────────────────────────────────────

export function createArmature(opts = {}) {
  const scene = getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  const arm = new THREE.Group();
  arm.name = opts.name || `Armature-${Math.floor(Math.random() * 1e6)}`;
  arm.userData[ARM_TAG] = true;
  arm.userData.archdiscStudioRigArmatureName = arm.name;
  if (opts.position && Array.isArray(opts.position) && opts.position.length === 3) {
    arm.position.set(opts.position[0], opts.position[1], opts.position[2]);
  }
  // Root bone — every armature has one even if the user never asks; the
  // first user-added bone parents to it by default. Length 0 so the
  // helper doesn't draw a stub from origin until real bones exist.
  const root = new THREE.Bone();
  root.name = 'Root';
  root.userData[BONE_TAG] = true;
  root.userData.archdiscStudioRigBoneLength = 0;
  arm.add(root);
  arm.userData.archdiscStudioRigRoot = root;
  scene.add(arm);
  rebuildSkeleton(arm);
  return { ok: true, uuid: arm.uuid, name: arm.name, rootUuid: root.uuid };
}

export function addBone(armUuid, parentBoneUuid, offsetXYZ, name) {
  const arm = findArmature(armUuid);
  if (!arm) return { ok: false, error: 'no armature' };
  let parent = parentBoneUuid ? findBoneInArmature(arm, parentBoneUuid) : arm.userData.archdiscStudioRigRoot;
  if (!parent) {
    // fall back to root if the supplied parent isn't in this armature
    parent = arm.userData.archdiscStudioRigRoot;
  }
  const offset = Array.isArray(offsetXYZ) && offsetXYZ.length === 3
    ? offsetXYZ
    : [0, 0.1, 0];
  const bone = new THREE.Bone();
  bone.name = name || `Bone-${parent.children.length + 1}`;
  bone.userData[BONE_TAG] = true;
  bone.position.set(offset[0], offset[1], offset[2]);
  // "Length" — the distance from this bone's origin to its (notional)
  // tail, which is just the offset magnitude. Stored for getBone readouts
  // and for skin.js's closest-bone falloff.
  bone.userData.archdiscStudioRigBoneLength = Math.hypot(offset[0], offset[1], offset[2]);
  parent.add(bone);
  rebuildSkeleton(arm);
  return { ok: true, uuid: bone.uuid, name: bone.name, parentUuid: parent.uuid, length: bone.userData.archdiscStudioRigBoneLength };
}

export function listBones(armUuid) {
  const arm = findArmature(armUuid);
  if (!arm) return { ok: false, error: 'no armature', count: 0, bones: [] };
  arm.updateMatrixWorld(true);
  const bones = [];
  arm.traverse((o) => {
    if (!o.isBone) return;
    bones.push({
      uuid: o.uuid,
      name: o.name,
      parentUuid: o.parent && o.parent.isBone ? o.parent.uuid : null,
      position: [o.position.x, o.position.y, o.position.z],
      rotation: [o.rotation.x, o.rotation.y, o.rotation.z],
      length: o.userData.archdiscStudioRigBoneLength || 0,
    });
  });
  return { ok: true, count: bones.length, bones };
}

export function getBone(boneUuid) {
  const bone = findBoneAnyArmature(boneUuid);
  if (!bone) return { ok: false, error: 'no bone' };
  // Refresh world matrices so position/rotation match the latest sets.
  const arm = findArmatureForBone(bone);
  if (arm) arm.updateMatrixWorld(true);
  const wp = new THREE.Vector3();
  bone.getWorldPosition(wp);
  return {
    ok: true,
    uuid: bone.uuid,
    name: bone.name,
    parentUuid: bone.parent && bone.parent.isBone ? bone.parent.uuid : null,
    position: [bone.position.x, bone.position.y, bone.position.z],
    worldPosition: [wp.x, wp.y, wp.z],
    rotation: [bone.rotation.x, bone.rotation.y, bone.rotation.z],
    length: bone.userData.archdiscStudioRigBoneLength || 0,
  };
}

export function setBoneRotation(boneUuid, eulerXYZ) {
  const bone = findBoneAnyArmature(boneUuid);
  if (!bone) return { ok: false, error: 'no bone' };
  if (!Array.isArray(eulerXYZ) || eulerXYZ.length !== 3) return { ok: false, error: 'bad euler' };
  bone.rotation.set(
    Number(eulerXYZ[0]) || 0,
    Number(eulerXYZ[1]) || 0,
    Number(eulerXYZ[2]) || 0,
  );
  const arm = findArmatureForBone(bone);
  if (arm) {
    arm.updateMatrixWorld(true);
    const skel = arm.userData.archdiscStudioRigSkeleton;
    if (skel && typeof skel.update === 'function') skel.update();
  }
  return { ok: true, uuid: bone.uuid, rotation: [bone.rotation.x, bone.rotation.y, bone.rotation.z] };
}

export function removeArmature(armUuid) {
  const arm = findArmature(armUuid);
  if (!arm) return { ok: false, error: 'no armature' };
  // If a SkinnedMesh was bound to this armature, unbind & restore a
  // plain Mesh in its place so the scene stays renderable.
  const scene = getScene();
  if (scene) {
    const skinned = [];
    scene.traverse((o) => {
      if (o.isSkinnedMesh && o.userData && o.userData.archdiscStudioRigArmatureUuid === arm.uuid) skinned.push(o);
    });
    for (const sm of skinned) {
      // Convert back to a plain Mesh so the user keeps their geometry.
      const mesh = new THREE.Mesh(sm.geometry, sm.material);
      mesh.position.copy(sm.position);
      mesh.rotation.copy(sm.rotation);
      mesh.scale.copy(sm.scale);
      mesh.userData = { ...sm.userData };
      delete mesh.userData.archdiscStudioRigArmatureUuid;
      delete mesh.userData.archdiscStudioRigOriginalMeshUuid;
      mesh.userData.archdiscStudioPrimitive = true;
      mesh.userData.archdiscStudioPrimitiveKind = sm.userData.archdiscStudioPrimitiveKind || 'mesh';
      sm.parent && sm.parent.remove(sm);
      scene.add(mesh);
    }
    // Remove any SkeletonHelper that points at this armature.
    const helpers = [];
    scene.traverse((o) => {
      if (o.userData && o.userData.archdiscStudioRigHelperFor === arm.uuid) helpers.push(o);
    });
    for (const h of helpers) h.parent && h.parent.remove(h);
  }
  const skel = arm.userData.archdiscStudioRigSkeleton;
  if (skel && typeof skel.dispose === 'function') {
    try { skel.dispose(); } catch (_) {}
  }
  arm.parent && arm.parent.remove(arm);
  return { ok: true, uuid: armUuid };
}

// Internal — exposed for skin.js / ik.js / helpers.js. Not bound to
// window so it doesn't pollute the public surface.
export const __internal = {
  findArmature,
  findBoneInArmature,
  findBoneAnyArmature,
  findArmatureForBone,
  rebuildSkeleton,
  ARM_TAG,
  BONE_TAG,
};
