// Slice 727 — Maya constraint system. Parent, aim, look-at, point,
// orient, scale, and path constraints. Each constraint binds a
// "constrained" object's transform to follow a "target" object every
// tick. Mirrors Maya's Constraint menu — essential for rigging.

import * as THREE from 'three';
import { chainIntoAnimTick, unchainFromAnimTick } from '../common/anim-tick.js';

const _constraints = new Map();
let _seq = 1;
function _uid() { return `cn-${_seq++}-${Date.now().toString(36)}`; }

function _obj(uuid) {
  return window.__archdiscScene?.getObjectByProperty('uuid', uuid);
}

function _apply(c) {
  const child = _obj(c.childUuid);
  const target = _obj(c.targetUuid);
  if (!child || !target) return;
  target.updateMatrixWorld(true);
  const tw = target.getWorldPosition(new THREE.Vector3());
  const tq = target.getWorldQuaternion(new THREE.Quaternion());
  const ts = target.getWorldScale(new THREE.Vector3());
  switch (c.kind) {
    case 'parent':
      child.position.copy(tw).addScaledVector(new THREE.Vector3(...(c.offset.position || [0, 0, 0])), 1);
      child.quaternion.copy(tq);
      child.scale.copy(ts);
      break;
    case 'point':
      child.position.copy(tw).addScaledVector(new THREE.Vector3(...(c.offset.position || [0, 0, 0])), 1);
      break;
    case 'orient':
      child.quaternion.copy(tq);
      break;
    case 'scale':
      child.scale.copy(ts);
      break;
    case 'aim': {
      const childPos = child.getWorldPosition(new THREE.Vector3());
      const dir = tw.clone().sub(childPos).normalize();
      const fwd = new THREE.Vector3(...(c.offset.aimAxis || [0, 0, 1]));
      child.quaternion.setFromUnitVectors(fwd, dir);
      break;
    }
    case 'lookAt':
      child.lookAt(tw);
      break;
    case 'path': {
      // c.offset.path is [[x,y,z], ...]; c.offset.t in [0,1] traverses it.
      const path = c.offset.path || [];
      const t = (c.offset.t || 0) % 1;
      if (path.length >= 2) {
        const seg = (path.length - 1) * t;
        const i = Math.floor(seg);
        const f = seg - i;
        const a = path[i], b = path[i + 1] || path[i];
        child.position.set(
          a[0] + (b[0] - a[0]) * f,
          a[1] + (b[1] - a[1]) * f,
          a[2] + (b[2] - a[2]) * f);
      }
      break;
    }
  }
}

export function create(kind, childUuid, targetUuid, opts) {
  const id = _uid();
  const c = {
    id, kind, childUuid, targetUuid,
    offset: opts?.offset || {},
    weight: Number(opts?.weight) || 1,
    enabled: opts?.enabled !== false,
  };
  _constraints.set(id, c);
  chainIntoAnimTick(`constraint_${id}`, () => { if (c.enabled) _apply(c); });
  _apply(c);
  return { ok: true, id };
}

export function setEnabled(id, enabled) {
  const c = _constraints.get(id);
  if (!c) return { ok: false };
  c.enabled = !!enabled;
  return { ok: true };
}

export function setOffset(id, offset) {
  const c = _constraints.get(id);
  if (!c) return { ok: false };
  c.offset = { ...c.offset, ...offset };
  _apply(c);
  return { ok: true };
}

export function setPathParameter(id, t) {
  const c = _constraints.get(id);
  if (!c) return { ok: false };
  if (c.kind !== 'path') return { ok: false };
  c.offset.t = Number(t);
  _apply(c);
  return { ok: true };
}

export function remove(id) {
  const c = _constraints.get(id);
  if (!c) return { ok: false };
  unchainFromAnimTick(`constraint_${id}`);
  _constraints.delete(id);
  return { ok: true };
}

export function listConstraints() {
  return {
    ok: true,
    constraints: Array.from(_constraints.values()).map((c) => ({
      id: c.id, kind: c.kind, childUuid: c.childUuid, targetUuid: c.targetUuid,
      weight: c.weight, enabled: c.enabled,
    })),
  };
}
