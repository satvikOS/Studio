// ArchDisc Studio V3 — SketchUp-style window cuts.
//
// cutWindow() mirrors cutDoor() but the cutter box starts at a
// non-zero sill height. The result is still a real boolean hole
// through the wall via __studioCSGDifference (slice 691). We also add
// a thin glass plane at the opening so a sun-lit scene reads
// architecturally.
//
// File deliberately named `window.js` per the slice brief — within
// this module we reference the browser global via the bracket form
// (globalThis['window']) so the bundler doesn't get confused with the
// module name.

import * as THREE from 'three';
import { wallCenterAt, wallDirection, wallNormal } from './wall.js';

/**
 * Real boolean cut of a window opening into a wall.
 *
 * @param {string} wallUuid
 * @param {number} atFraction — 0..1 along the wall centerline
 * @param {number} width — opening width in metres
 * @param {number} height — opening height in metres
 * @param {number} sillHeight — distance from ground to bottom of opening (default 0.9)
 */
export async function cutWindow(wallUuid, atFraction, width, height, sillHeight) {
  const W = (typeof globalThis !== 'undefined') ? globalThis : null;
  const win = W ? W.window || W : null;
  const scene = (win && win.__archdiscScene) || (win && win.__archdiscViewport && win.__archdiscViewport.scene) || null;
  if (!scene) return { ok: false, error: 'no scene' };
  const wallMesh = _findMesh(scene, wallUuid);
  if (!wallMesh) return { ok: false, error: 'wall not found' };
  if (!win || typeof win.__studioCSGDifference !== 'function') {
    return { ok: false, error: 'CSG not installed (need slice 691 __studioCSGDifference)' };
  }

  const w = (typeof width === 'number' && isFinite(width) && width > 0) ? width : 1.2;
  const h = (typeof height === 'number' && isFinite(height) && height > 0) ? height : 1.0;
  const sill = (typeof sillHeight === 'number' && isFinite(sillHeight) && sillHeight >= 0) ? sillHeight : 0.9;
  const f = Math.min(1, Math.max(0, Number(atFraction) || 0.5));

  const meta = wallMesh.userData && wallMesh.userData.archdiscStudioArchWall;
  if (!meta) return { ok: false, error: 'mesh is not an arch-wall' };
  const wallTh = meta.thickness || 0.2;

  const center = wallCenterAt(wallMesh, f);
  const dir = wallDirection(wallMesh);
  const norm = wallNormal(wallMesh);

  const cutterGeo = new THREE.BoxGeometry(w, h, wallTh * 1.5);
  const cutter = new THREE.Mesh(
    cutterGeo,
    new THREE.MeshBasicMaterial({ color: 0x00ffff, visible: false }),
  );
  cutter.name = '_arch-window-cutter';
  cutter.userData = {
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: 'csg-input',
    _archEphemeral: true,
  };
  cutter.position.set(center.x, sill + h * 0.5, center.z);
  const angle = Math.atan2(dir.x, dir.z);
  cutter.rotation.y = Math.PI * 0.5 - angle;
  cutter.updateMatrixWorld(true);
  scene.add(cutter);

  let result;
  try {
    result = await win.__studioCSGDifference(wallMesh.uuid, cutter.uuid);
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
  newWall.name = wallMesh.name || 'arch-wall';
  newWall.userData = newWall.userData || {};
  newWall.userData.archdiscStudioPrimitive = true;
  newWall.userData.archdiscStudioPrimitiveKind = 'arch-wall';
  newWall.userData.archdiscStudioArchWall = Object.assign({}, meta, { hasWindow: true });
  if (wallMesh.material) {
    if (newWall.material && newWall.material.dispose) newWall.material.dispose();
    newWall.material = wallMesh.material.clone();
  }
  newWall.castShadow = true;
  newWall.receiveShadow = true;

  _removeAndDispose(cutter);
  _removeAndDispose(wallMesh);

  // Glass infill — a thin transparent box sitting in the opening so
  // the scene reads as having a window rather than an empty hole.
  const glass = _buildGlass(center, dir, norm, w, h, sill, wallTh);
  scene.add(glass);

  return { ok: true, uuid: newWall.uuid, glassUuid: glass.uuid, op: 'window-cut' };
}

function _buildGlass(center, dir, norm, w, h, sill, wallTh) {
  const glassTh = Math.max(0.012, wallTh * 0.08);
  const geo = new THREE.BoxGeometry(w * 0.92, h * 0.92, glassTh);
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x9bc7d6,
    roughness: 0.08,
    metalness: 0.0,
    transmission: 0.85,
    transparent: true,
    opacity: 0.55,
    ior: 1.4,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'arch-window-glass';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.position.set(center.x, sill + h * 0.5, center.z);
  const angle = Math.atan2(dir.x, dir.z);
  mesh.rotation.y = Math.PI * 0.5 - angle;
  mesh.userData = {
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: 'arch-window-glass',
    archdiscStudioArchWindowGlass: { width: w, height: h, sillHeight: sill, wallThickness: wallTh },
  };
  mesh.updateMatrixWorld(true);
  return mesh;
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
