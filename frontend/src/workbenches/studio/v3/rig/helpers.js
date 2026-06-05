// ArchDisc Studio V3 — rig visualisation helpers.
//
// Adds a THREE.SkeletonHelper to the scene for an armature, tagged
// `archdiscStudioGizmo: true` so existing scene scrubbers (outliner,
// select-all, snapshot/restore) skip it. Idempotent: re-calling for an
// armature that already has a helper removes the old one first so the
// scene doesn't accumulate orphan helpers when the user toggles.

import * as THREE from 'three';
import { __internal as armInt } from './armature.js';

function getScene() {
  return (typeof window !== 'undefined' && (window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene))) || null;
}

export function showSkeletonHelper(armUuid) {
  const scene = getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  const arm = armInt.findArmature(armUuid);
  if (!arm) return { ok: false, error: 'no armature' };
  // Drop any prior helper for this armature.
  const prior = [];
  scene.traverse((o) => {
    if (o.userData && o.userData.archdiscStudioRigHelperFor === arm.uuid) prior.push(o);
  });
  for (const p of prior) p.parent && p.parent.remove(p);

  const helper = new THREE.SkeletonHelper(arm);
  helper.material.linewidth = 2;
  helper.userData = {
    ...helper.userData,
    archdiscStudioGizmo: true,
    archdiscStudioRigHelperFor: arm.uuid,
  };
  scene.add(helper);
  arm.userData.archdiscStudioRigHelper = helper;
  return { ok: true, helperUuid: helper.uuid, armUuid: arm.uuid, boneCount: helper.bones.length };
}

export function hideSkeletonHelper(armUuid) {
  const scene = getScene();
  if (!scene) return { ok: false, error: 'no scene' };
  const arm = armInt.findArmature(armUuid);
  if (!arm) return { ok: false, error: 'no armature' };
  let removed = 0;
  const doomed = [];
  scene.traverse((o) => {
    if (o.userData && o.userData.archdiscStudioRigHelperFor === arm.uuid) doomed.push(o);
  });
  for (const d of doomed) { d.parent && d.parent.remove(d); removed++; }
  arm.userData.archdiscStudioRigHelper = null;
  return { ok: true, removed };
}
