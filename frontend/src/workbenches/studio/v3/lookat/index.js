// ArchDisc Studio V3 — look-at constraint (slice 864).
// Forces a bone/object to face a target. Head/eye tracking.

import * as THREE from 'three';
import { registerOps } from '../common/registry.js';
let _installed = false;
const _constraints = [];
function _tick() {
  const scene = window.__archdiscScene; if (!scene) return;
  for (const c of _constraints) {
    const src = scene.getObjectByProperty('uuid', c.sourceUuid);
    const tgt = scene.getObjectByProperty('uuid', c.targetUuid);
    if (!src || !tgt) continue;
    const wp = new THREE.Vector3(); tgt.getWorldPosition(wp);
    const sp = new THREE.Vector3(); src.getWorldPosition(sp);
    const dir = wp.clone().sub(sp).normalize();
    const yaw = Math.atan2(dir.x, dir.z);
    const pitch = -Math.asin(dir.y);
    src.rotation.y = yaw * c.weight + (1 - c.weight) * src.rotation.y;
    src.rotation.x = pitch * c.weight + (1 - c.weight) * src.rotation.x;
  }
}
let _hooked = false;
function _hook() {
  if (_hooked) return; _hooked = true;
  const vp = window.__archdiscViewport;
  if (vp) { const prev = vp.__studioAnimTick; vp.__studioAnimTick = (n) => { prev?.(n); _tick(); }; }
}
export function installLookAt() {
  if (_installed) return { ok: true, already: true };
  _installed = true;
  const ops = {
    __studioLookAtAdd: ({ sourceUuid, targetUuid, weight = 1 } = {}) => {
      _constraints.push({ sourceUuid, targetUuid, weight }); _hook(); return { ok: true };
    },
    __studioLookAtRemove: ({ sourceUuid } = {}) => {
      for (let i = _constraints.length - 1; i >= 0; i--) if (_constraints[i].sourceUuid === sourceUuid) _constraints.splice(i, 1);
      return { ok: true };
    },
    __studioLookAtList: () => ({ ok: true, constraints: _constraints.slice() }),
  };
  for (const [n, fn] of Object.entries(ops)) window[n] = fn;
  registerOps(ops, 'rig', 'Look-at constraint');
  return { ok: true };
}
export default installLookAt;
