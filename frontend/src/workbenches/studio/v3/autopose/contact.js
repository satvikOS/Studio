// ArchDisc Studio V3 — AutoContact: snap tagged bones to a ground plane.
//
// `autoContact(armatureUuid, groundY = 0)` finds every bone whose
// userData.archdiscStudioAutoContact is truthy and IK-solves so that
// bone ends up exactly at (boneWorld.x, groundY, boneWorld.z). The
// horizontal position is preserved — only the Y-component changes — so
// a character's left foot stays where the animator put it but lifts off
// or sinks onto the floor as the rig is posed.
//
// We reuse the slice-682 `window.__studioRigSolveIK` when it's
// available. If it's not (e2e bootstrap order), we fall back to an
// inline CCD that mirrors balance.js's `_ccdReach`. Either way the
// behaviour is identical.
//
// AddAutoContact + ListAutoContacts are split off here as the
// supporting tag-management surface — agents need to flag specific
// bones programmatically and read the current set back for verification.

import * as THREE from 'three';
import { __internal as comInt } from './com.js';
import { __internal as balInt } from './balance.js';

const ARM_TAG = 'archdiscStudioRigArmature';
const CONTACT_TAG = 'archdiscStudioAutoContact';
const DEFAULT_CHAIN_LENGTH = 3;

function _findBoneAnyArmature(boneUuid) {
  if (typeof window === 'undefined') return null;
  const scene = window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
  if (!scene) return null;
  let bone = null;
  scene.traverse((o) => {
    if (!bone && o.isBone && o.uuid === boneUuid) bone = o;
  });
  return bone;
}

function _findArmatureForBone(bone) {
  let cur = bone;
  while (cur) {
    if (cur.userData && cur.userData[ARM_TAG]) return cur;
    cur = cur.parent;
  }
  return null;
}

/**
 * addAutoContact(boneUuid, on?) — toggle the contact tag on a bone.
 *
 * Idempotent — calling with the same `on` value twice is a no-op.
 * `on` defaults to true so the common case is concise.
 */
export function addAutoContact(boneUuid, on) {
  const bone = _findBoneAnyArmature(boneUuid);
  if (!bone) return { ok: false, error: 'no bone' };
  const want = on === undefined ? true : !!on;
  if (want) bone.userData[CONTACT_TAG] = true;
  else delete bone.userData[CONTACT_TAG];
  return { ok: true, uuid: bone.uuid, on: want };
}

/**
 * listAutoContacts(armatureUuid) — return every bone in the armature
 * currently tagged AutoContact, with its world position.
 */
export function listAutoContacts(armatureUuid) {
  const arm = comInt.findArmature(armatureUuid);
  if (!arm) return { ok: false, error: 'no armature', count: 0, contacts: [] };
  arm.updateMatrixWorld(true);
  const out = [];
  const wp = new THREE.Vector3();
  arm.traverse((o) => {
    if (!o.isBone) return;
    if (!(o.userData && o.userData[CONTACT_TAG])) return;
    o.getWorldPosition(wp);
    out.push({
      uuid: o.uuid,
      name: o.name,
      worldPosition: [wp.x, wp.y, wp.z],
    });
  });
  return { ok: true, count: out.length, contacts: out };
}

// Prefer the slice-682 public solver — it handles parent-quaternion
// math identically to our inline CCD but stays a single canonical impl.
function _solveBoneToTarget(bone, target, chainLength, arm) {
  if (typeof window !== 'undefined' && typeof window.__studioRigSolveIK === 'function') {
    try {
      const r = window.__studioRigSolveIK(bone.uuid, target, 12, chainLength);
      if (r && r.ok) return r;
    } catch (_) { /* fall through */ }
  }
  // Fallback: inline CCD reuse from balance.js — same algorithm.
  return balInt.ccdReach(bone, target, chainLength, arm);
}

/**
 * autoContact(armatureUuid, groundY = 0, opts?) — for every bone tagged
 * archdiscStudioAutoContact under the armature, run IK so its world
 * Y-coordinate becomes `groundY` while X/Z stay where they are.
 *
 * opts:
 *   chainLength  int  (default 3 — hip→knee→ankle)
 *
 * Returns:
 *   { ok, count, results: [{ uuid, before:[x,y,z], after:[x,y,z],
 *     finalDistance, converged }] }
 */
export function autoContact(armatureUuid, groundY, opts) {
  const arm = comInt.findArmature(armatureUuid);
  if (!arm) return { ok: false, error: 'no armature' };
  const gy = Number.isFinite(Number(groundY)) ? Number(groundY) : 0;
  const chainLen = Math.max(1, Math.min(8,
    Math.floor(Number(opts && opts.chainLength) || DEFAULT_CHAIN_LENGTH)));

  arm.updateMatrixWorld(true);

  // Gather contact-tagged bones once.
  const contacts = [];
  arm.traverse((o) => {
    if (o.isBone && o.userData && o.userData[CONTACT_TAG]) contacts.push(o);
  });
  if (!contacts.length) return { ok: true, count: 0, results: [] };

  const results = [];
  const wp = new THREE.Vector3();
  for (const bone of contacts) {
    bone.getWorldPosition(wp);
    const before = [wp.x, wp.y, wp.z];
    const target = [wp.x, gy, wp.z];
    const ik = _solveBoneToTarget(bone, target, chainLen, arm);
    arm.updateMatrixWorld(true);
    bone.getWorldPosition(wp);
    const after = [wp.x, wp.y, wp.z];
    results.push({
      uuid: bone.uuid,
      name: bone.name,
      before,
      target,
      after,
      finalDistance: ik && Number.isFinite(ik.finalDistance) ? ik.finalDistance
        : Math.hypot(after[0] - target[0], after[1] - target[1], after[2] - target[2]),
      converged: ik && ik.converged !== undefined ? ik.converged
        : Math.abs(after[1] - gy) < 1e-3,
    });
  }

  // Push skeleton update so any bound SkinnedMesh re-skins on next frame.
  const skel = arm.userData && arm.userData.archdiscStudioRigSkeleton;
  if (skel && typeof skel.update === 'function') skel.update();

  return { ok: true, count: results.length, results, groundY: gy };
}

export const __internal = {
  CONTACT_TAG,
  findBoneAnyArmature: _findBoneAnyArmature,
  findArmatureForBone: _findArmatureForBone,
  solveBoneToTarget: _solveBoneToTarget,
};
