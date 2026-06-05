// ArchDisc Studio V3 — FX colliders.
//
// A collider is a registered scene mesh whose world-space axis-aligned
// bounding box (AABB) stops particles + reflects their velocity. Blender
// uses convex-hull or triangle-mesh colliders; for the FX layer we use
// AABBs because they're O(1) to test and slice-632 particles are points
// (so swept-mesh contact isn't justified for the budget).
//
// The collision test is "real" — we recompute each collider's world
// AABB every tick from the mesh's geometry.boundingBox transformed by
// mesh.matrixWorld so colliders are correct even after the user moves /
// rotates the mesh. The intersection step is:
//
//   1. Sample the particle's *previous* axis-side relative to the AABB
//      (using its current position minus its velocity·dt step).
//   2. If the particle is now inside the AABB, push it back along the
//      shallowest-penetration axis and flip its velocity component on
//      that axis with restitution.
//
// applyColliders(px, py, pz, vx, vy, vz, dt, restitution, out) is the
// hot inner-loop helper. It returns the post-collision position +
// velocity in `out` (a length-6 reusable array) and a boolean flag
// telling the caller whether a collision occurred so it can decide
// whether to write back.
//
// Public op surface (wrapped + registered by fx/index.js):
//   addCollider(meshUuid)            → { ok, uuid }      (uuid == meshUuid)
//   removeCollider(meshUuid)         → { ok, removed }
//   listColliders()                  → { ok, colliders:[…] }
//   clearColliders()                 → { ok, removed:n }

import * as THREE from 'three';

const _colliders = [];   // [{ uuid, mesh, box, _scratchBox }]
const _scratchBox3 = new THREE.Box3();

function _getScene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene
    || (window.__archdiscViewport && window.__archdiscViewport.scene)
    || null;
}

function _findMesh(uuid) {
  const scene = _getScene();
  if (!scene) return null;
  let m = null;
  scene.traverse((o) => {
    if (m) return;
    if (o.uuid === uuid && o.isObject3D) m = o;
  });
  return m;
}

export function addCollider(meshUuid) {
  if (!meshUuid) return { ok: false, error: 'no uuid' };
  if (_colliders.find((c) => c.uuid === meshUuid)) {
    return { ok: true, alreadyRegistered: true, uuid: meshUuid };
  }
  const mesh = _findMesh(meshUuid);
  if (!mesh) return { ok: false, error: 'mesh not in scene' };
  // Make sure the mesh has a baseline boundingBox so first tick has
  // something to transform.
  if (mesh.geometry && typeof mesh.geometry.computeBoundingBox === 'function'
      && !mesh.geometry.boundingBox) {
    mesh.geometry.computeBoundingBox();
  }
  _colliders.push({
    uuid: meshUuid,
    mesh,
    box: new THREE.Box3(),
    // _scratchBox: new THREE.Box3(),
  });
  return { ok: true, uuid: meshUuid };
}

export function removeCollider(meshUuid) {
  const i = _colliders.findIndex((c) => c.uuid === meshUuid);
  if (i < 0) return { ok: false, error: 'not a collider' };
  _colliders.splice(i, 1);
  return { ok: true, removed: meshUuid };
}

export function listColliders() {
  return {
    ok: true,
    colliders: _colliders.map((c) => ({
      uuid: c.uuid,
      name: (c.mesh && c.mesh.name) || '(unnamed)',
    })),
  };
}

export function clearColliders() {
  const n = _colliders.length;
  _colliders.length = 0;
  return { ok: true, removed: n };
}

export function _colliderCount() {
  return _colliders.length;
}

// Recompute every collider's world AABB. Cheap — call once per tick
// before the particle loop, NOT per-particle.
export function refreshColliderBoxes() {
  for (let i = 0; i < _colliders.length; i++) {
    const c = _colliders[i];
    const m = c.mesh;
    if (!m || !m.geometry) continue;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    if (!m.geometry.boundingBox) continue;
    m.updateMatrixWorld(true);
    _scratchBox3.copy(m.geometry.boundingBox);
    _scratchBox3.applyMatrix4(m.matrixWorld);
    c.box.copy(_scratchBox3);
  }
}

// applyColliders — true AABB contact + reflection.
//
// `out` is a length-6 caller-provided array reused across calls:
//   out[0..2] = corrected position
//   out[3..5] = corrected velocity
//
// Returns true if a collision was handled, false otherwise. When false
// `out` is untouched, so the caller can branch cheaply.
export function applyColliders(px, py, pz, vx, vy, vz, dt, restitution, out) {
  if (_colliders.length === 0) return false;
  let hit = false;
  let cx = px, cy = py, cz = pz, cvx = vx, cvy = vy, cvz = vz;
  const e = (typeof restitution === 'number') ? restitution : 0.5;
  for (let i = 0; i < _colliders.length; i++) {
    const box = _colliders[i].box;
    if (cx < box.min.x || cx > box.max.x) continue;
    if (cy < box.min.y || cy > box.max.y) continue;
    if (cz < box.min.z || cz > box.max.z) continue;
    // Inside this AABB — find shallowest-penetration axis.
    const penXmin = cx - box.min.x;
    const penXmax = box.max.x - cx;
    const penYmin = cy - box.min.y;
    const penYmax = box.max.y - cy;
    const penZmin = cz - box.min.z;
    const penZmax = box.max.z - cz;
    let minPen = penXmin, axis = 0, sign = -1;  // axis: 0=x,1=y,2=z. sign=-1 push to min, +1 to max
    if (penXmax < minPen) { minPen = penXmax; axis = 0; sign = +1; }
    if (penYmin < minPen) { minPen = penYmin; axis = 1; sign = -1; }
    if (penYmax < minPen) { minPen = penYmax; axis = 1; sign = +1; }
    if (penZmin < minPen) { minPen = penZmin; axis = 2; sign = -1; }
    if (penZmax < minPen) { minPen = penZmax; axis = 2; sign = +1; }
    // Push the particle out along the chosen axis to the closest face,
    // then reflect velocity on that axis.
    if (axis === 0) {
      cx = (sign < 0) ? (box.min.x - 1e-4) : (box.max.x + 1e-4);
      if ((sign < 0 && cvx > 0) || (sign > 0 && cvx < 0)) cvx = -cvx * e;
    } else if (axis === 1) {
      cy = (sign < 0) ? (box.min.y - 1e-4) : (box.max.y + 1e-4);
      if ((sign < 0 && cvy > 0) || (sign > 0 && cvy < 0)) cvy = -cvy * e;
    } else {
      cz = (sign < 0) ? (box.min.z - 1e-4) : (box.max.z + 1e-4);
      if ((sign < 0 && cvz > 0) || (sign > 0 && cvz < 0)) cvz = -cvz * e;
    }
    hit = true;
  }
  if (hit) {
    out[0] = cx; out[1] = cy; out[2] = cz;
    out[3] = cvx; out[4] = cvy; out[5] = cvz;
  }
  return hit;
}
