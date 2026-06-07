// Slice 778 — Houdini-tier convex RBD installer.
//
// Wires the GJK + EPA + impulse-response convex rigid-body pipeline
// into the V3 window op surface. After install:
//
//   window.__studioConvexRBDCreate({meshUuid, position, velocity, mass,
//                                   restitution, friction, [setKey]})
//                                  → { ok, bodyKey, setKey }
//   window.__studioConvexRBDStep({setKey, dt})
//                                  → { ok, collisions:[{aKey,bKey,normal,depth}] }
//   window.__studioConvexRBDList() → { ok, sets:[…], totalBodies }
//   window.__studioConvexRBDRemove({bodyKey, setKey})
//                                  → { ok, removed }
//   window.__studioConvexRBDSetGravity({setKey, g})
//                                  → { ok, gravity }
//   window.__studioConvexRBDClearSet({setKey})
//                                  → { ok }
//
// A "set" is one ConvexRBDSolver. Bodies belong to a set; passing no
// setKey to Create lands the body in the default set (auto-created on
// first use). This mirrors the slice 767 RBD destruction module which
// also keys solvers by set.
//
// Pure JS. No new deps. Idempotent install/uninstall.

import { registerOps, unregisterOps } from '../common/registry.js';
import { ConvexRBDSolver } from './solver.js';
import { convexHullFromMesh, convexHullFromPoints, convexHullFromBox } from './convexHull.js';

const DEFAULT_SET = 'default';

let _installed = false;
const _sets = new Map();       // setKey → ConvexRBDSolver
const _bodyToSet = new Map();  // bodyKey → setKey

function _getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function _findMesh(uuid) {
  const scene = _getScene();
  if (!scene || !uuid) return null;
  return scene.getObjectByProperty('uuid', uuid) || null;
}

function _ensureSet(setKey) {
  const k = setKey || DEFAULT_SET;
  if (!_sets.has(k)) {
    _sets.set(k, new ConvexRBDSolver({
      gravity: [0, -9.81, 0],
      groundY: null,
      iterations: 4,
    }));
  }
  return { key: k, solver: _sets.get(k) };
}

// ─── Op implementations ────────────────────────────────────────────────

function opCreate(args) {
  const a = args || {};
  const { key: setKey, solver } = _ensureSet(a.setKey);

  // Build a hull. Prefer the mesh's geometry. Fall back to a box if a
  // `size:[w,h,d]` is supplied. Fall back to a point cloud if `points`
  // is supplied. Otherwise error.
  let hull = null;
  let mesh = null;
  if (a.meshUuid) {
    mesh = _findMesh(a.meshUuid);
    if (!mesh) return { ok: false, error: `no mesh for uuid ${a.meshUuid}` };
    hull = convexHullFromMesh(mesh);
    if (!hull.vertices.length) {
      return { ok: false, error: 'mesh has no vertices' };
    }
  } else if (Array.isArray(a.size) && a.size.length === 3) {
    hull = convexHullFromBox(a.size[0] / 2, a.size[1] / 2, a.size[2] / 2);
  } else if (Array.isArray(a.points) && a.points.length >= 4) {
    hull = convexHullFromPoints(a.points);
  } else {
    return { ok: false, error: 'need meshUuid, size:[w,h,d], or points:[…]' };
  }

  // Body position defaults to the mesh's current scene position so the
  // sim takes over right where the user dropped the mesh.
  let initPos = a.position;
  if (!initPos && mesh) {
    initPos = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z };
  }
  const body = solver.addBody({
    position:    initPos,
    velocity:    a.velocity,
    mass:        a.mass,
    restitution: a.restitution,
    friction:    a.friction,
    inertia:     a.inertia,
    hull,
    mesh,
  });
  _bodyToSet.set(body.key, setKey);
  return { ok: true, bodyKey: body.key, setKey, vertexCount: hull.vertices.length };
}

function opStep(args) {
  const a = args || {};
  const setKey = a.setKey || DEFAULT_SET;
  const solver = _sets.get(setKey);
  if (!solver) return { ok: false, error: `no set ${setKey}` };
  const r = solver.step(Number(a.dt) || 1 / 60);
  return { ok: true, collisions: r.collisions, setKey };
}

function opList() {
  const sets = [];
  let totalBodies = 0;
  for (const [k, s] of _sets) {
    const bodies = s.bodies.map((b) => ({
      key: b.key,
      mass: b.mass,
      static: b.static,
      position: [b.position.x, b.position.y, b.position.z],
      velocity: [b.velocity.x, b.velocity.y, b.velocity.z],
      vertexCount: b.hull ? b.hull.vertices.length : 0,
    }));
    totalBodies += bodies.length;
    sets.push({
      setKey: k,
      bodyCount: bodies.length,
      gravity: s.gravity.slice(),
      groundY: s.groundY,
      bodies,
    });
  }
  return { ok: true, sets, totalBodies };
}

function opRemove(args) {
  const a = args || {};
  if (!a.bodyKey) return { ok: false, error: 'missing bodyKey' };
  const setKey = a.setKey || _bodyToSet.get(a.bodyKey);
  const solver = setKey ? _sets.get(setKey) : null;
  if (!solver) return { ok: false, error: 'no solver for body' };
  const removed = solver.removeBody(a.bodyKey);
  if (removed) _bodyToSet.delete(a.bodyKey);
  return { ok: removed, removed };
}

function opSetGravity(args) {
  const a = args || {};
  const setKey = a.setKey || DEFAULT_SET;
  const solver = _sets.get(setKey);
  if (!solver) return { ok: false, error: `no set ${setKey}` };
  solver.setGravity(a.g);
  return { ok: true, gravity: solver.gravity.slice() };
}

function opSetGround(args) {
  const a = args || {};
  const setKey = a.setKey || DEFAULT_SET;
  const solver = _sets.get(setKey);
  if (!solver) return { ok: false, error: `no set ${setKey}` };
  solver.groundY = (a.groundY === null || a.groundY === false) ? null : Number(a.groundY);
  return { ok: true, groundY: solver.groundY };
}

function opClearSet(args) {
  const a = args || {};
  const setKey = a.setKey || DEFAULT_SET;
  const solver = _sets.get(setKey);
  if (!solver) return { ok: true };
  for (const b of solver.bodies) _bodyToSet.delete(b.key);
  _sets.delete(setKey);
  return { ok: true };
}

// ─── Install / uninstall ──────────────────────────────────────────────

const OP_NAMES = [
  '__studioConvexRBDCreate',
  '__studioConvexRBDStep',
  '__studioConvexRBDList',
  '__studioConvexRBDRemove',
  '__studioConvexRBDSetGravity',
  '__studioConvexRBDSetGround',
  '__studioConvexRBDClearSet',
];

export function installConvexRBD() {
  if (typeof window === 'undefined') return { ok: false, error: 'no window' };
  if (_installed || window.__studioConvexRBDInstalled) {
    return { ok: true, alreadyInstalled: true };
  }
  _installed = true;
  window.__studioConvexRBDInstalled = true;
  const ops = {
    __studioConvexRBDCreate: [opCreate,
      'Create a convex rigid body (full GJK collision + EPA penetration + impulse response).'],
    __studioConvexRBDStep: [opStep,
      'Step the convex RBD solver: integrate, run GJK/EPA, resolve impulses.'],
    __studioConvexRBDList: [opList,
      'List every convex RBD set and its bodies.'],
    __studioConvexRBDRemove: [opRemove,
      'Remove a convex rigid body by bodyKey.'],
    __studioConvexRBDSetGravity: [opSetGravity,
      'Set the gravity vector for a convex RBD set.'],
    __studioConvexRBDSetGround: [opSetGround,
      'Set or clear the ground plane Y for a convex RBD set.'],
    __studioConvexRBDClearSet: [opClearSet,
      'Tear down an entire convex RBD set.'],
  };
  registerOps(ops, 'sim',
    'Houdini-tier convex RBD — full GJK collision + EPA penetration + impulse response (slice 778).');
  return { ok: true, ops: OP_NAMES.length };
}

export function uninstallConvexRBD() {
  if (typeof window === 'undefined') return { ok: false };
  if (!_installed) return { ok: true };
  _sets.clear();
  _bodyToSet.clear();
  unregisterOps(OP_NAMES);
  _installed = false;
  window.__studioConvexRBDInstalled = false;
  return { ok: true };
}

export const __internal = { _sets, _bodyToSet };
export default installConvexRBD;
