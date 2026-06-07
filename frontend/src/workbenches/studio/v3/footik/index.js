// ArchDisc Studio V3 — foot IK / hip placement (slice 863).
// Raycast under each foot to the ground; if no ground, drop hip until
// at least one foot connects. Standard FOOT_IK.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
function _adjust({ armUuid, leftFoot = 'L_Foot', rightFoot = 'R_Foot', hips = 'Hips', rayLength = 0.1 } = {}) {
  const scene = window.__archdiscScene; if (!scene) return { ok: false };
  const arm = scene.getObjectByProperty('uuid', armUuid);
  if (!arm) return { ok: false };
  const bones = {};
  arm.traverse((o) => { if (o.isBone || o.userData?.archdiscStudioBone) bones[o.name] = o; });
  const L = bones[leftFoot], R = bones[rightFoot], H = bones[hips];
  if (!L || !R || !H) return { ok: false, error: 'bones not found' };
  const rc = new THREE.Raycaster();
  const ground = [];
  scene.traverse((o) => { if (o.isMesh && o.userData?.archdiscStudioPrimitiveKind === 'plane') ground.push(o); });
  if (!ground.length) return { ok: false, error: 'no ground' };
  function _foot(b) {
    const wp = new THREE.Vector3(); b.getWorldPosition(wp);
    rc.set(new THREE.Vector3(wp.x, wp.y + rayLength, wp.z), new THREE.Vector3(0, -1, 0));
    rc.far = rayLength * 2;
    const hits = rc.intersectObjects(ground, false);
    return hits[0]?.point.y ?? wp.y;
  }
  const lY = _foot(L), rY = _foot(R);
  const minY = Math.min(lY, rY);
  // Drop hips by the deepest foot deficit
  H.position.y -= Math.max(0, H.parent.worldToLocal(new THREE.Vector3(0, minY, 0)).y * 0.5);
  return { ok: true, leftY: lY, rightY: rY };
}
export function installFootIK() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = { __studioFootIKAdjust: _adjust };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rig', 'Foot IK + hip placement');
  return { ok: true };
}
export default installFootIK;
