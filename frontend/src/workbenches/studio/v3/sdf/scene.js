// Slice 697 — SDFScene: ordered op list with per-op union/subtract/
// intersect mode and optional smooth-blend k. Evaluate at any point.

import {
  sdSphere, sdBox, sdCapsule, sdTorus, sdCylinder, sdPlane,
  smin, smax, opUnion, opSubtract, opIntersect,
} from './primitives.js';

const KINDS = {
  sphere: (op, p) => sdSphere(p, op.pos || [0, 0, 0], op.r ?? 0.5),
  box:    (op, p) => sdBox(p, op.pos || [0, 0, 0], op.b || [0.5, 0.5, 0.5]),
  capsule:(op, p) => sdCapsule(p, op.a || [0, -0.5, 0], op.b || [0, 0.5, 0], op.r ?? 0.2),
  torus:  (op, p) => sdTorus(p, op.pos || [0, 0, 0], op.R ?? 0.5, op.r ?? 0.15),
  cylinder:(op, p) => sdCylinder(p, op.pos || [0, 0, 0], op.h ?? 0.5, op.r ?? 0.3),
  plane:  (op, p) => sdPlane(p, op.n || [0, 1, 0], op.offset ?? 0),
};

let _seq = 1;
function _uuid() { return `sdf-${_seq++}-${Date.now().toString(36)}`; }

export function makeScene() { return { ops: [], smoothK: 0 }; }

export function addOp(scene, kind, params) {
  if (!KINDS[kind]) return { ok: false, error: 'unknown kind' };
  const op = Object.assign({ uuid: _uuid(), kind, mode: 'union' }, params || {});
  scene.ops.push(op);
  return { ok: true, uuid: op.uuid };
}

export function removeOp(scene, uuid) {
  const i = scene.ops.findIndex((o) => o.uuid === uuid);
  if (i < 0) return { ok: false };
  scene.ops.splice(i, 1);
  return { ok: true };
}

export function reorderOp(scene, uuid, newIdx) {
  const i = scene.ops.findIndex((o) => o.uuid === uuid);
  if (i < 0) return { ok: false };
  const [op] = scene.ops.splice(i, 1);
  scene.ops.splice(Math.max(0, Math.min(scene.ops.length, newIdx)), 0, op);
  return { ok: true };
}

export function evaluate(scene, p) {
  let d = Infinity;
  const k = scene.smoothK || 0;
  for (let i = 0; i < scene.ops.length; i++) {
    const op = scene.ops[i];
    const v = KINDS[op.kind](op, p);
    if (i === 0 || op.mode === 'union') {
      d = (op.smoothK || k) > 0 ? smin(d, v, op.smoothK || k) : opUnion(d, v);
    } else if (op.mode === 'subtract') {
      d = (op.smoothK || k) > 0 ? -smin(-d, -v, op.smoothK || k) : opSubtract(v, d);
    } else if (op.mode === 'intersect') {
      d = (op.smoothK || k) > 0 ? smax(d, v, op.smoothK || k) : opIntersect(d, v);
    }
  }
  return d;
}

export function serialize(scene) {
  return JSON.stringify({ ops: scene.ops, smoothK: scene.smoothK });
}
export function deserialize(json) {
  try {
    const o = JSON.parse(json);
    return { ops: Array.isArray(o.ops) ? o.ops : [], smoothK: Number(o.smoothK) || 0 };
  } catch (_) { return makeScene(); }
}
