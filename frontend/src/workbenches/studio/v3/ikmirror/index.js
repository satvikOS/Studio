// ArchDisc Studio V3 — IK + pose mirroring (slice 811).
import { registerOps } from '../common/registry.js';
let _installed = false;
function _pairs(armatureUuid) {
  const scene = window.__archdiscScene;
  if (!scene) return [];
  const arm = scene.getObjectByProperty('uuid', armatureUuid);
  if (!arm) return [];
  const bones = [];
  arm.traverse((o) => { if (o.isBone || o.userData?.archdiscStudioBone) bones.push(o); });
  const pairs = [];
  const lefts = bones.filter((b) => /_L($|[\.\d])/.test(b.name));
  for (const l of lefts) {
    const r = bones.find((b) => b.name === l.name.replace(/_L($|[\.\d])/, '_R$1'));
    if (r) pairs.push({ left: l, right: r });
  }
  return pairs;
}
function _mirrorBones(armatureUuid, axis = 'x') {
  const ps = _pairs(armatureUuid);
  for (const { left, right } of ps) {
    // mirror rotation around axis
    const lq = left.quaternion.clone();
    const rq = right.quaternion.clone();
    if (axis === 'x') {
      right.quaternion.set(lq.x, -lq.y, -lq.z, lq.w);
      left.quaternion.set(rq.x, -rq.y, -rq.z, rq.w);
    } else if (axis === 'y') {
      right.quaternion.set(-lq.x, lq.y, -lq.z, lq.w);
      left.quaternion.set(-rq.x, rq.y, -rq.z, rq.w);
    } else {
      right.quaternion.set(-lq.x, -lq.y, lq.z, lq.w);
      left.quaternion.set(-rq.x, -rq.y, rq.z, rq.w);
    }
  }
  return { ok: true, pairCount: ps.length };
}
export function installIKMirror() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioIKMirrorBones: ({ armUuid, axis = 'x' } = {}) => _mirrorBones(armUuid, axis),
    __studioIKPasteMirrored: ({ armUuid, sourcePose } = {}) => {
      if (!sourcePose) return { ok: false };
      const ps = _pairs(armUuid);
      // sourcePose: { boneName: [ex,ey,ez] }
      for (const { left, right } of ps) {
        const src = sourcePose[left.name];
        if (src) { right.rotation.set(src[0], -src[1], -src[2]); }
      }
      return { ok: true, applied: ps.length };
    },
    __studioIKFindPairs: ({ armUuid } = {}) => ({ ok: true, pairs: _pairs(armUuid).map((p) => [p.left.name, p.right.name]) }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rig', 'IK + pose mirroring');
  return { ok: true };
}
export default installIKMirror;
