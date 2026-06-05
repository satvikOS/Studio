// ArchDisc Studio V3 — Cascadeur-style center-of-mass solver.
//
// `computeCOM(armatureUuid)` walks every bone under the armature, treats
// each parent→child segment as a finite-density cylinder, and returns
// the volume-weighted average of the segment midpoints in WORLD space.
//
// Why "volume" and not "length"?  Cascadeur's COM model assumes mass
// scales with the visible limb thickness — a torso bone is dramatically
// heavier than a finger bone of the same length. Without skinned-mesh
// metadata we approximate the bone's radius from
//   userData.archdiscStudioAutoPoseRadius (caller may pin a real number)
// or fall back to (segmentLength × 0.18), which matches the slim
// cylindrical default Studio's primitives use.
//
// Mass contribution per segment:
//   m_i = π * r_i² * len_i   (cylinder volume × unit density)
//   COM = Σ (m_i · midpoint_i) / Σ m_i
//
// We do NOT recurse into the SkinnedMesh geometry; for a rigging-only
// tool that would be both expensive and circular (the mesh deforms with
// the bones we're trying to balance). The bone hierarchy is the
// authoritative skeleton-mass proxy.

import * as THREE from 'three';

const ARM_TAG = 'archdiscStudioRigArmature';

function getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
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

// Bone radius — explicit override > skeleton-helper hint > derived from
// segment length. Clamped to a sane physical range so finger-thin bones
// don't drop to zero mass.
function _boneRadius(bone, segLen) {
  if (bone && bone.userData && Number.isFinite(bone.userData.archdiscStudioAutoPoseRadius)) {
    return Math.max(1e-3, Number(bone.userData.archdiscStudioAutoPoseRadius));
  }
  if (bone && bone.userData && Number.isFinite(bone.userData.archdiscStudioRigBoneRadius)) {
    return Math.max(1e-3, Number(bone.userData.archdiscStudioRigBoneRadius));
  }
  // 18 % of segment length is the rule-of-thumb humanoid limb aspect ratio.
  const r = Math.max(1e-3, segLen * 0.18);
  return r;
}

/**
 * computeCOM(armatureUuid) — volume-weighted center of mass of an armature.
 *
 * Returns:
 *   { ok: true,
 *     com:  [x, y, z],          // WORLD-space coordinates
 *     mass: number,             // total summed segment volume (unit density)
 *     segments: number,         // how many bone→child segments contributed
 *     groundedY: number }       // lowest world-Y any bone touches
 *   { ok: false, error: string }
 */
export function computeCOM(armatureUuid) {
  const arm = findArmature(armatureUuid);
  if (!arm) return { ok: false, error: 'no armature' };
  arm.updateMatrixWorld(true);

  // Collect every bone in deterministic traversal order.
  const bones = [];
  arm.traverse((o) => { if (o.isBone) bones.push(o); });
  if (!bones.length) return { ok: false, error: 'no bones' };

  // Per-segment volume × midpoint. A "segment" is a parent bone → child
  // bone link; the parent's world position is the head, the child's is
  // the tail. Bones with no bone-children (leaves) contribute zero mass
  // — they have no length unless the caller supplied a stub child or
  // explicit tail. This matches Blender's "bones-have-a-tail-only-if-
  // they-have-a-child" convention.
  const parentPos = new THREE.Vector3();
  const childPos = new THREE.Vector3();
  let totalMass = 0;
  const weightedX = { x: 0, y: 0, z: 0 };
  let segments = 0;
  let groundedY = Infinity;

  for (const bone of bones) {
    bone.getWorldPosition(parentPos);
    if (parentPos.y < groundedY) groundedY = parentPos.y;
    // Walk this bone's IMMEDIATE bone-children (skip non-bone helpers).
    for (const child of bone.children) {
      if (!child.isBone) continue;
      child.getWorldPosition(childPos);
      const dx = childPos.x - parentPos.x;
      const dy = childPos.y - parentPos.y;
      const dz = childPos.z - parentPos.z;
      const segLen = Math.hypot(dx, dy, dz);
      if (segLen < 1e-6) continue;
      const r = _boneRadius(bone, segLen);
      // m = π r² L, unit density. Constants drop out of weighted-avg
      // numerator/denominator, but we keep them so `mass` is a meaningful
      // physical number for downstream gravity/jump math.
      const m = Math.PI * r * r * segLen;
      const midX = (parentPos.x + childPos.x) * 0.5;
      const midY = (parentPos.y + childPos.y) * 0.5;
      const midZ = (parentPos.z + childPos.z) * 0.5;
      weightedX.x += m * midX;
      weightedX.y += m * midY;
      weightedX.z += m * midZ;
      totalMass += m;
      segments += 1;
    }
  }

  if (totalMass < 1e-12) {
    // Degenerate skeleton (all leaves, or all coincident bones) — fall
    // back to the average bone position so the COM is at least defined.
    const avg = new THREE.Vector3();
    for (const b of bones) {
      b.getWorldPosition(parentPos);
      avg.add(parentPos);
    }
    avg.divideScalar(bones.length);
    return {
      ok: true,
      com: [avg.x, avg.y, avg.z],
      mass: 0,
      segments: 0,
      groundedY: Number.isFinite(groundedY) ? groundedY : 0,
      degenerate: true,
    };
  }

  return {
    ok: true,
    com: [
      weightedX.x / totalMass,
      weightedX.y / totalMass,
      weightedX.z / totalMass,
    ],
    mass: totalMass,
    segments,
    groundedY: Number.isFinite(groundedY) ? groundedY : 0,
  };
}

// Internal — exposed for balance.js / contact.js so they don't all need
// their own armature/bone scan.
export const __internal = {
  findArmature,
  boneRadius: _boneRadius,
  ARM_TAG,
};
