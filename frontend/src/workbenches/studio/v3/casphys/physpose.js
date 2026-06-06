// Slice 710 — Cascadeur physics-pose. Given a skeleton, solve for a
// posture that satisfies (a) user-fixed bone positions ("pins") and
// (b) global center-of-mass directly above support polygon (feet).
// Iteratively projects each pinned bone toward its target while
// re-balancing the pelvis. Mirrors Cascadeur's "auto-balance / ghost
// physics" assistance.

import * as THREE from 'three';

const _pins = new Map();   // bone uuid → world target Vector3

export function addPin(boneUuid, targetWorld) {
  _pins.set(boneUuid, new THREE.Vector3(...targetWorld));
  return { ok: true };
}

export function removePin(boneUuid) {
  _pins.delete(boneUuid);
  return { ok: true };
}

export function clearPins() { _pins.clear(); return { ok: true }; }

function _walkBones(root, fn) {
  if (!root || !root.isBone) return;
  fn(root);
  for (const c of root.children) if (c.isBone) _walkBones(c, fn);
}

function _comOfBones(root) {
  const com = new THREE.Vector3();
  let count = 0;
  _walkBones(root, (b) => {
    const wp = b.getWorldPosition(new THREE.Vector3());
    com.add(wp); count++;
  });
  if (count > 0) com.multiplyScalar(1 / count);
  return com;
}

// Two-bone analytical IK as fallback to reach pinned end effectors.
function _reachPin(root, endUuid, target) {
  const scene = window.__archdiscScene;
  if (!scene) return;
  const end = scene.getObjectByProperty('uuid', endUuid);
  if (!end || !end.isBone) return;
  const lower = end.parent;
  const upper = lower?.parent;
  if (!lower || !upper) return;
  const upperWorld = upper.getWorldPosition(new THREE.Vector3());
  const reachDist = upperWorld.distanceTo(target);
  const upperLowerLen = lower.position.length();
  const lowerEndLen = end.position.length();
  const cosA = (upperLowerLen * upperLowerLen + lowerEndLen * lowerEndLen - reachDist * reachDist)
    / (2 * upperLowerLen * lowerEndLen);
  const a = Math.acos(Math.max(-1, Math.min(1, cosA)));
  lower.rotation.set(0, 0, Math.PI - a);
  const aim = target.clone().sub(upperWorld).normalize();
  const fwd = new THREE.Vector3(0, -1, 0);
  upper.quaternion.setFromUnitVectors(fwd, aim);
}

function _supportPolygonCenter(root) {
  // Find the lowest two bones (feet) and average them.
  const positions = [];
  _walkBones(root, (b) => {
    const wp = b.getWorldPosition(new THREE.Vector3());
    positions.push(wp);
  });
  positions.sort((a, b) => a.y - b.y);
  if (positions.length < 2) return positions[0] || new THREE.Vector3();
  return positions[0].clone().lerp(positions[1], 0.5);
}

export function solve(rootUuid, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const root = scene.getObjectByProperty('uuid', rootUuid);
  if (!root || !root.isBone) return { ok: false };
  const iterations = Math.max(1, Math.min(20, Number(opts?.iterations) || 6));
  for (let it = 0; it < iterations; it++) {
    // Reach each pinned bone.
    for (const [boneUuid, target] of _pins.entries()) {
      _reachPin(root, boneUuid, target);
    }
    // Balance: nudge root so COM is above support polygon.
    const com = _comOfBones(root);
    const supp = _supportPolygonCenter(root);
    const dx = supp.x - com.x;
    const dz = supp.z - com.z;
    root.position.x += dx * 0.3;
    root.position.z += dz * 0.3;
  }
  return { ok: true, iterations, pinned: _pins.size };
}

export function ghostPhysics(opts) {
  // Run an animated solve over N frames; per-frame call solve() on the
  // current pinned skeleton root. Caller can move the targets between
  // frames to scrub through a motion plan.
  const root = opts?.rootUuid;
  const onFrame = opts?.onFrame;
  const frames = Math.max(1, Math.min(240, Number(opts?.frames) || 30));
  let f = 0;
  function _tick() {
    if (f >= frames) return;
    if (onFrame) {
      try { onFrame(f); } catch (_) {}
    }
    solve(root);
    f++;
    requestAnimationFrame(_tick);
  }
  _tick();
  return { ok: true, frames };
}

export function listPins() {
  return {
    ok: true,
    pins: Array.from(_pins.entries()).map(([uuid, t]) => ({ uuid, target: [t.x, t.y, t.z] })),
  };
}
