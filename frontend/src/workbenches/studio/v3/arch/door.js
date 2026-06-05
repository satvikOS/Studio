// ArchDisc Studio V3 — SketchUp-style door cuts.
//
// cutDoor() opens an actual hole in the wall geometry. Approach:
//   1. Locate the wall mesh by uuid.
//   2. Build a "cutter" THREE.Mesh (a box) sized to the desired
//      opening: width × height × (wall thickness × 1.1). Position it
//      at the requested fractional position along the wall, on the
//      ground.
//   3. Drop both meshes into the scene momentarily so manifold-3d sees
//      their world matrices, then call window.__studioCSGDifference
//      (slice 691) which itself attaches a NEW mesh tagged
//      archdiscStudioPrimitiveKind === 'csg-result'.
//   4. Promote that result mesh to be the new wall: re-tag it as
//      arch-wall, copy the original wall's userData metadata, remove
//      the original wall + cutter from the scene, dispose them.
//   5. Build a thin door-frame mesh (a flat plane at the opening) and
//      add it to the scene as a child reference.
//
// The result mesh inherits its parent's transform via the CSG bake — it
// is placed at world-space identity but its vertices are in world
// coordinates, so it sits visually in the same spot the original wall
// occupied.

import * as THREE from 'three';
import { wallCenterAt, wallDirection, wallNormal } from './wall.js';

/**
 * Real boolean cut of a door opening into a wall.
 *
 * @param {string} wallUuid — uuid of the wall mesh in __archdiscScene
 * @param {number} atFraction — 0..1 along the wall centerline
 * @param {number} width — opening width in metres
 * @param {number} height — opening height in metres (from ground up)
 * @returns {Promise<{ ok: boolean, uuid?: string, frameUuid?: string, error?: string }>}
 */
export async function cutDoor(wallUuid, atFraction, width, height) {
  const scene = _scene();
  if (!scene) return { ok: false, error: 'no scene' };
  const wall = _findMesh(scene, wallUuid);
  if (!wall) return { ok: false, error: 'wall not found' };
  if (typeof window === 'undefined' || typeof window.__studioCSGDifference !== 'function') {
    return { ok: false, error: 'CSG not installed (need slice 691 __studioCSGDifference)' };
  }

  const w = (typeof width === 'number' && isFinite(width) && width > 0) ? width : 0.9;
  const h = (typeof height === 'number' && isFinite(height) && height > 0) ? height : 2.1;
  const f = Math.min(1, Math.max(0, Number(atFraction) || 0.5));

  const meta = wall.userData && wall.userData.archdiscStudioArchWall;
  if (!meta) return { ok: false, error: 'mesh is not an arch-wall' };
  const wallTh = meta.thickness || 0.2;

  // Cutter is a box sized: w (along wall direction) × h (vertical)
  // × wallTh * 1.5 (deeper than the wall on both sides so we get a
  // clean through-hole even with float imprecision).
  const center = wallCenterAt(wall, f);
  const dir = wallDirection(wall);
  const norm = wallNormal(wall);
  // Build the box at the origin then orient/translate it via the
  // mesh's transform so we can keep BoxGeometry simple.
  const cutterGeo = new THREE.BoxGeometry(w, h, wallTh * 1.5);
  const cutter = new THREE.Mesh(
    cutterGeo,
    new THREE.MeshBasicMaterial({ color: 0xff00ff, visible: false }),
  );
  cutter.name = '_arch-door-cutter';
  cutter.userData = {
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: 'csg-input',
    _archEphemeral: true,
  };
  // Cutter origin sits in the centre of the door opening at h/2 above
  // the ground.
  cutter.position.set(center.x, h * 0.5, center.z);
  // Align cutter local +X with the wall direction. dir = (dx, 0, dz).
  // angle = atan2(dx, dz). rotation.y = (PI/2 - angle) sends local +X
  // to (sin angle, 0, cos angle) = (dx, 0, dz).
  const angle = Math.atan2(dir.x, dir.z);
  cutter.rotation.y = Math.PI * 0.5 - angle;
  cutter.updateMatrixWorld(true);
  scene.add(cutter);

  // Run the boolean. __studioCSGDifference returns a Promise resolving
  // to { ok, uuid, verts, op:'difference' }.
  let result;
  try {
    result = await window.__studioCSGDifference(wall.uuid, cutter.uuid);
  } catch (e) {
    _removeAndDispose(cutter);
    return { ok: false, error: e && e.message ? e.message : String(e) };
  }
  if (!result || !result.ok || !result.uuid) {
    _removeAndDispose(cutter);
    return { ok: false, error: (result && result.error) || 'csg difference failed' };
  }

  const newWall = _findMesh(scene, result.uuid);
  if (!newWall) {
    _removeAndDispose(cutter);
    return { ok: false, error: 'csg result mesh not in scene' };
  }
  // Promote to a wall: copy metadata, re-name, retire the old wall.
  newWall.name = wall.name || 'arch-wall';
  newWall.userData = newWall.userData || {};
  newWall.userData.archdiscStudioPrimitive = true;
  newWall.userData.archdiscStudioPrimitiveKind = 'arch-wall';
  newWall.userData.archdiscStudioArchWall = Object.assign({}, meta, { hasDoor: true });
  // Match the original wall's material so the CSG result doesn't pop
  // visually (CSG places a default grey material).
  if (wall.material) {
    if (newWall.material && newWall.material.dispose) newWall.material.dispose();
    newWall.material = wall.material.clone();
  }
  newWall.castShadow = true;
  newWall.receiveShadow = true;

  _removeAndDispose(cutter);
  // Remove the original wall now that the cut wall has taken its place.
  _removeAndDispose(wall);

  // Door-frame: a thin flat rectangle around the opening for visual
  // reference. We mount it as a separate sibling mesh.
  const frame = _buildDoorFrame(center, dir, norm, w, h, wallTh);
  scene.add(frame);

  return { ok: true, uuid: newWall.uuid, frameUuid: frame.uuid, op: 'door-cut' };
}

function _buildDoorFrame(center, dir, norm, w, h, wallTh) {
  // Build a flat L-shaped jamb made of three thin boxes (left, right,
  // top), grouped into a single mesh via merging into a Group.
  const frameTh = Math.max(0.04, wallTh * 0.5);
  const jambDepth = wallTh * 1.05;
  const grp = new THREE.Group();
  grp.name = 'arch-door-frame';
  const mat = new THREE.MeshStandardMaterial({
    color: 0x3b2a1a,
    roughness: 0.6,
    metalness: 0.05,
  });

  const left = new THREE.Mesh(new THREE.BoxGeometry(frameTh, h, jambDepth), mat);
  left.position.set(-w * 0.5 - frameTh * 0.5, h * 0.5, 0);

  const right = new THREE.Mesh(new THREE.BoxGeometry(frameTh, h, jambDepth), mat);
  right.position.set(w * 0.5 + frameTh * 0.5, h * 0.5, 0);

  const top = new THREE.Mesh(new THREE.BoxGeometry(w + frameTh * 2, frameTh, jambDepth), mat);
  top.position.set(0, h + frameTh * 0.5, 0);

  for (const m of [left, right, top]) {
    m.castShadow = true;
    m.receiveShadow = true;
    grp.add(m);
  }
  grp.position.set(center.x, 0, center.z);
  const angle = Math.atan2(dir.x, dir.z);
  grp.rotation.y = Math.PI * 0.5 - angle;
  grp.userData = {
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: 'arch-door-frame',
    archdiscStudioArchDoorFrame: { width: w, height: h, wallThickness: wallTh },
  };
  grp.updateMatrixWorld(true);
  return grp;
}

function _scene() {
  if (typeof window === 'undefined') return null;
  return window.__archdiscScene || (window.__archdiscViewport && window.__archdiscViewport.scene) || null;
}

function _findMesh(scene, uuid) {
  if (!scene || !uuid) return null;
  let hit = null;
  scene.traverse((o) => { if (!hit && o.uuid === uuid && o.isMesh) hit = o; });
  return hit;
}

function _removeAndDispose(obj) {
  if (!obj) return;
  if (obj.parent) obj.parent.remove(obj);
  obj.traverse?.((o) => {
    if (o.geometry && o.geometry.dispose) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m && m.map && m.map.dispose) m.map.dispose();
        if (m && m.dispose) m.dispose();
      }
    }
  });
  if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
  if (obj.material) {
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of mats) {
      if (m && m.map && m.map.dispose) m.map.dispose();
      if (m && m.dispose) m.dispose();
    }
  }
}
