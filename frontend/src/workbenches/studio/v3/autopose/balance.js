// ArchDisc Studio V3 — Cascadeur-style AutoBalance.
//
// Given a partial pose, rotate the spine + hip bones so the projected
// center of mass (XZ ground plane) lands INSIDE the polygon defined by
// the feet's world positions. The feet bones are pinned by re-solving
// IK on each foot chain to the foot's CURRENT world position; the spine
// bones bend incrementally to drag the COM toward the foot polygon's
// centroid.
//
// Bone tagging convention:
//   userData.archdiscStudioAutoPoseFoot  = true     → a foot end-effector
//   userData.archdiscStudioAutoPoseSpine = true     → bend in balance pass
//
// If the caller didn't tag any bones, we fall back to:
//   feet  = every leaf bone whose y is within 0.15 of the lowest leaf
//   spine = every bone on the path between the COM-of-feet upwards
//
// Algorithm (iterative, stable):
//   1.  Compute current COM + foot polygon (XZ projection).
//   2.  Compute polygon centroid c. If COM_xz is already inside the
//       polygon's convex hull AND within `tolerance` of c we return.
//   3.  Capture each foot's WORLD position f_i (the pin we restore).
//   4.  Rotate each spine bone by a small Δ toward the vector
//       (c - COM_xz). The rotation is applied in the bone's local Y-up
//       plane: we cross-product the COM-offset vector with the bone's
//       world "up" to get the rotation axis, then convert to local space.
//   5.  Re-solve IK on every foot chain so the foot returns to f_i.
//   6.  Repeat up to `iterations` times or until the COM sits inside
//       the foot polygon and the centroid distance < tolerance.
//
// Returns rich diagnostics so the e2e spec can assert convergence.

import * as THREE from 'three';
import { computeCOM, __internal as comInt } from './com.js';

const ARM_TAG = 'archdiscStudioRigArmature';
const FOOT_TAG = 'archdiscStudioAutoPoseFoot';
const SPINE_TAG = 'archdiscStudioAutoPoseSpine';
const DEFAULT_ITERATIONS = 12;
const DEFAULT_STEP = 0.18;       // radians per iter per spine bone
const DEFAULT_TOLERANCE = 0.04;  // metres — half a foot width

// 2-D cross (z-component of 3-D cross) — used for convex containment.
function _cross2(ax, ay, bx, by) {
  return ax * by - ay * bx;
}

// Andrew's monotone chain — small + correct + no deps.
function _convexHullXZ(points) {
  if (points.length <= 2) return points.slice();
  const pts = points.slice().sort((a, b) =>
    a[0] === b[0] ? a[2] - b[2] : a[0] - b[0]
  );
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 &&
      _cross2(
        lower[lower.length - 1][0] - lower[lower.length - 2][0],
        lower[lower.length - 1][2] - lower[lower.length - 2][2],
        p[0] - lower[lower.length - 2][0],
        p[2] - lower[lower.length - 2][2]) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 &&
      _cross2(
        upper[upper.length - 1][0] - upper[upper.length - 2][0],
        upper[upper.length - 1][2] - upper[upper.length - 2][2],
        p[0] - upper[upper.length - 2][0],
        p[2] - upper[upper.length - 2][2]) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// Point-in-convex-polygon (XZ plane). For 1 vertex returns false unless
// the query coincides with it; for 2 vertices it tests proximity to the
// segment within 1cm (single-foot stance).
function _pointInPolygonXZ(px, pz, poly) {
  if (poly.length === 0) return false;
  if (poly.length === 1) {
    const d = Math.hypot(px - poly[0][0], pz - poly[0][2]);
    return d < 0.01;
  }
  if (poly.length === 2) {
    // Distance from point to segment.
    const [a, b] = poly;
    const dx = b[0] - a[0], dz = b[2] - a[2];
    const len2 = dx * dx + dz * dz;
    if (len2 < 1e-9) return Math.hypot(px - a[0], pz - a[2]) < 0.01;
    let t = ((px - a[0]) * dx + (pz - a[2]) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = a[0] + t * dx, qz = a[2] + t * dz;
    return Math.hypot(px - qx, pz - qz) < 0.05;
  }
  // Winding test on the convex polygon — all cross-products must share a sign.
  let prev = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = _cross2(b[0] - a[0], b[2] - a[2], px - a[0], pz - a[2]);
    if (Math.abs(c) > 1e-9) {
      if (prev === 0) prev = c > 0 ? 1 : -1;
      else if ((c > 0 ? 1 : -1) !== prev) return false;
    }
  }
  return true;
}

function _centroid(poly) {
  if (!poly.length) return [0, 0, 0];
  let x = 0, z = 0, y = 0;
  for (const p of poly) { x += p[0]; y += p[1]; z += p[2]; }
  return [x / poly.length, y / poly.length, z / poly.length];
}

// Find feet bones — explicit tag wins; otherwise lowest-Y leaves.
function _findFeet(arm) {
  const tagged = [];
  arm.traverse((o) => {
    if (o.isBone && o.userData && o.userData[FOOT_TAG]) tagged.push(o);
  });
  if (tagged.length) return tagged;

  // Heuristic: collect every leaf bone (no bone-children), then keep the
  // ones whose world-Y is within 0.15 m of the minimum leaf.
  const leaves = [];
  const wp = new THREE.Vector3();
  arm.traverse((o) => {
    if (!o.isBone) return;
    const hasBoneChild = o.children.some((c) => c.isBone);
    if (!hasBoneChild) {
      o.getWorldPosition(wp);
      leaves.push({ bone: o, y: wp.y });
    }
  });
  if (!leaves.length) return [];
  let minY = Infinity;
  for (const l of leaves) if (l.y < minY) minY = l.y;
  return leaves.filter((l) => l.y - minY < 0.15).map((l) => l.bone);
}

// Find spine bones — explicit tag wins; otherwise return every bone NOT
// on a foot-ancestor chain and NOT a leaf, so we only rotate the trunk.
function _findSpine(arm, feet) {
  const tagged = [];
  arm.traverse((o) => {
    if (o.isBone && o.userData && o.userData[SPINE_TAG]) tagged.push(o);
  });
  if (tagged.length) return tagged;

  const footAncestors = new Set();
  for (const f of feet) {
    let cur = f;
    while (cur && cur.isBone) {
      footAncestors.add(cur);
      cur = cur.parent;
    }
  }
  const spine = [];
  arm.traverse((o) => {
    if (!o.isBone) return;
    if (footAncestors.has(o)) return; // never rotate leg chain itself
    const hasBoneChild = o.children.some((c) => c.isBone);
    if (!hasBoneChild) return;        // leaf bones (hands, head) are skipped
    spine.push(o);
  });
  return spine;
}

// Walk up the parent chain from `bone`, collecting bones above (and
// including) the bone itself, up to but not including the armature root
// Group. Capped at chainLength.
function _chainAbove(bone, chainLength) {
  const out = [];
  let cur = bone.parent;
  let n = 0;
  while (cur && cur.isBone && n < chainLength) {
    out.push(cur);
    cur = cur.parent;
    n++;
  }
  return out;
}

// One CCD pass to drive `effector` to `targetWorldPos`. Cheaper than the
// rig package's solveIK because we're calling it dozens of times per
// balance iteration; same shortest-arc-rotor math as rig/ik.js.
function _ccdReach(effector, targetWorldPos, chainLength, arm) {
  const chain = _chainAbove(effector, chainLength);
  if (!chain.length) return { ok: false, error: 'no chain' };
  const target = new THREE.Vector3(targetWorldPos[0], targetWorldPos[1], targetWorldPos[2]);
  const bonePos = new THREE.Vector3();
  const effPos = new THREE.Vector3();
  const vE = new THREE.Vector3();
  const vT = new THREE.Vector3();
  const qWorld = new THREE.Quaternion();
  const parentWorldQ = new THREE.Quaternion();
  const parentWorldQInv = new THREE.Quaternion();
  const qLocal = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const boneWorldQ = new THREE.Quaternion();
  const ITERS = 6;
  const EPS = 1e-4;
  let dist = Infinity;
  for (let it = 0; it < ITERS; it++) {
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
      qWorld.setFromUnitVectors(vE, vT);
      if (bone.parent) {
        bone.parent.matrixWorld.decompose(tmpV, parentWorldQ, tmpS);
        parentWorldQInv.copy(parentWorldQ).invert();
      } else {
        parentWorldQ.identity();
        parentWorldQInv.identity();
      }
      bone.matrixWorld.decompose(tmpV, boneWorldQ, tmpS);
      const newWorldQ = qWorld.clone().multiply(boneWorldQ);
      qLocal.copy(parentWorldQInv).multiply(newWorldQ);
      bone.quaternion.copy(qLocal);
      bone.updateMatrixWorld(true);
    }
    arm.updateMatrixWorld(true);
    effector.getWorldPosition(effPos);
    dist = effPos.distanceTo(target);
    if (dist < EPS) break;
  }
  return { ok: true, finalDistance: dist };
}

/**
 * autoBalance(armatureUuid, opts) — bend spine bones until the COM
 * projection on the XZ plane is inside the foot polygon.
 *
 * opts:
 *   iterations     int  (default 12)
 *   step           rad  per-bone tilt per iter (default 0.18)
 *   tolerance      m    centroid distance accepted as "balanced" (0.04)
 *   spineChain     int  parent-chain depth re-solved for each foot (4)
 *
 * Returns:
 *   { ok, iterations, balanced, comStart:[x,y,z], comEnd:[x,y,z],
 *     centroid:[x,y,z], feet:[uuid...], spineRotated:int,
 *     finalDistance: number }
 */
export function autoBalance(armatureUuid, opts) {
  const o = opts || {};
  const arm = comInt.findArmature(armatureUuid);
  if (!arm) return { ok: false, error: 'no armature' };
  const iters = Math.max(1, Math.min(64, Math.floor(Number(o.iterations) || DEFAULT_ITERATIONS)));
  const step = Math.max(1e-4, Math.min(1, Number(o.step) || DEFAULT_STEP));
  const tol  = Math.max(1e-4, Number(o.tolerance) || DEFAULT_TOLERANCE);
  const spineChainDepth = Math.max(1, Math.min(8, Math.floor(Number(o.spineChain) || 4)));

  arm.updateMatrixWorld(true);

  const feet = _findFeet(arm);
  if (!feet.length) return { ok: false, error: 'no feet bones tagged or detected' };
  const spine = _findSpine(arm, feet);
  if (!spine.length) {
    return { ok: false, error: 'no spine bones to rotate' };
  }

  const com0 = computeCOM(armatureUuid);
  if (!com0.ok) return { ok: false, error: com0.error };

  // Pin foot world positions — every IK re-solve drives them back here.
  const footPins = feet.map((f) => {
    const wp = new THREE.Vector3();
    f.getWorldPosition(wp);
    return [wp.x, wp.y, wp.z];
  });
  const footPoints = footPins.slice();
  const polygon = _convexHullXZ(footPoints);
  const centroid = _centroid(polygon);

  // Already balanced? Return immediately so the caller can short-circuit.
  if (
    _pointInPolygonXZ(com0.com[0], com0.com[2], polygon) &&
    Math.hypot(com0.com[0] - centroid[0], com0.com[2] - centroid[2]) < tol
  ) {
    return {
      ok: true,
      iterations: 0,
      balanced: true,
      comStart: com0.com,
      comEnd: com0.com,
      centroid,
      feet: feet.map((f) => f.uuid),
      spine: spine.map((b) => b.uuid),
      spineRotated: 0,
      finalDistance: Math.hypot(com0.com[0] - centroid[0], com0.com[2] - centroid[2]),
    };
  }

  // Scratch reused inside the loop.
  const wp = new THREE.Vector3();
  const bonePos = new THREE.Vector3();
  const parentQ = new THREE.Quaternion();
  const parentQInv = new THREE.Quaternion();
  const boneWorldQ = new THREE.Quaternion();
  const qWorld = new THREE.Quaternion();
  const qLocal = new THREE.Quaternion();
  const dummy = new THREE.Vector3();

  let spineRotated = 0;
  let lastCOM = com0.com.slice();
  let did = 0;
  let balanced = false;

  for (let it = 0; it < iters; it++) {
    did = it + 1;
    // Per-iter COM + offset toward centroid.
    const cur = computeCOM(armatureUuid);
    if (!cur.ok) break;
    lastCOM = cur.com.slice();
    const dx = centroid[0] - cur.com[0];
    const dz = centroid[2] - cur.com[2];
    const d  = Math.hypot(dx, dz);

    if (_pointInPolygonXZ(cur.com[0], cur.com[2], polygon) && d < tol) {
      balanced = true;
      break;
    }
    if (d < 1e-6) break;
    const nx = dx / d, nz = dz / d;

    // Distribute the desired tilt across spine bones (lower spine bones
    // contribute more leverage). We rotate each spine bone by `step`
    // radians around an axis perpendicular to the (nx, 0, nz) push.
    // axis = up × push = (0, 1, 0) × (nx, 0, nz) = (-nz, 0, nx) normalised.
    // BUT we want bending in the direction OF the push, so the rotation
    // pulls the upper half of the body toward the centroid. World-axis
    // vector to encode:
    const axisWorld = new THREE.Vector3(-nz, 0, nx); // already unit-length
    const stepThisIter = step * (1 - it / (iters * 2));  // ease the tilt

    for (const bone of spine) {
      arm.updateMatrixWorld(true);
      if (bone.parent) {
        bone.parent.matrixWorld.decompose(dummy, parentQ, bonePos);
        parentQInv.copy(parentQ).invert();
      } else {
        parentQ.identity();
        parentQInv.identity();
      }
      bone.matrixWorld.decompose(dummy, boneWorldQ, bonePos);
      qWorld.setFromAxisAngle(axisWorld, stepThisIter);
      const newWorldQ = qWorld.clone().multiply(boneWorldQ);
      qLocal.copy(parentQInv).multiply(newWorldQ);
      bone.quaternion.copy(qLocal);
      bone.updateMatrixWorld(true);
      spineRotated++;
    }

    // Re-pin each foot via CCD so the legs catch up with the spine bend.
    for (let i = 0; i < feet.length; i++) {
      _ccdReach(feet[i], footPins[i], spineChainDepth, arm);
    }
    arm.updateMatrixWorld(true);
  }

  // Final COM read.
  const comF = computeCOM(armatureUuid);
  const comEnd = comF.ok ? comF.com : lastCOM;
  const finalDistance = Math.hypot(comEnd[0] - centroid[0], comEnd[2] - centroid[2]);
  if (!balanced) {
    balanced = _pointInPolygonXZ(comEnd[0], comEnd[2], polygon);
  }

  // Push skeleton update so any bound SkinnedMesh re-skins on next frame.
  const skel = arm.userData && arm.userData.archdiscStudioRigSkeleton;
  if (skel && typeof skel.update === 'function') skel.update();

  return {
    ok: true,
    iterations: did,
    balanced,
    comStart: com0.com,
    comEnd,
    centroid,
    feet: feet.map((f) => f.uuid),
    spine: spine.map((b) => b.uuid),
    spineRotated,
    finalDistance,
  };
}

// Exposed for diagnostics + reuse from contact.js.
export const __internal = {
  findFeet: _findFeet,
  findSpine: _findSpine,
  convexHullXZ: _convexHullXZ,
  pointInPolygonXZ: _pointInPolygonXZ,
  centroid: _centroid,
  ccdReach: _ccdReach,
  FOOT_TAG,
  SPINE_TAG,
};
