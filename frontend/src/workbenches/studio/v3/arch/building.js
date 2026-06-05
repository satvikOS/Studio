// ArchDisc Studio V3 — full building generator.
//
// generateBuilding() composes the wall/floor/roof primitives into a
// complete house in one call. It is the SketchUp "Architectural
// Template" shortcut: pass a footprint polygon, the number of floors,
// and a wall height; receive every primitive uuid back in scene order.
//
// We deliberately keep this purely additive — no door/window cuts
// here, since those require the manifold-3d WASM and a Promise chain.
// The caller can run cutDoor/cutWindow against any of the returned
// wall uuids afterwards.

import * as THREE from 'three';

import { createWall } from './wall.js';
import { createFloor } from './floor.js';
import { createGableRoof } from './roof.js';

/**
 * @param {Array<[number,number] | {x,z}>} footprint — XZ polygon (closed or open)
 * @param {number} floors — number of stories (default 1, min 1)
 * @param {number} wallHeight — height per floor in metres (default 2.7)
 * @param {object} opts
 * @param {number} opts.floorThickness — slab thickness (default 0.18)
 * @param {number} opts.wallThickness — wall thickness (default 0.2)
 * @param {number} opts.ridgeHeight — roof ridge above eaves (default 1.6)
 * @param {number} opts.overhang — eaves overhang (default 0.3)
 * @param {boolean} opts.includeRoof — add a gable roof on top (default true)
 * @param {boolean} opts.includeFloors — add slab per storey (default true)
 * @returns {{ meshes: THREE.Object3D[], uuids: string[], anatomy: object }}
 */
export function generateBuilding(footprint, floors, wallHeight, opts) {
  const o = opts || {};
  const pts = _coerce(footprint);
  if (pts.length < 3) throw new Error('generateBuilding: need at least 3 polygon points');
  const nFloors = Math.max(1, Math.floor(Number(floors) || 1));
  const wh = (typeof wallHeight === 'number' && isFinite(wallHeight) && wallHeight > 0) ? wallHeight : 2.7;
  const floorTh = (typeof o.floorThickness === 'number' && o.floorThickness > 0) ? o.floorThickness : 0.18;
  const wallTh = (typeof o.wallThickness === 'number' && o.wallThickness > 0) ? o.wallThickness : 0.2;
  const ridgeH = (typeof o.ridgeHeight === 'number' && o.ridgeHeight > 0) ? o.ridgeHeight : 1.6;
  const overhang = (typeof o.overhang === 'number' && o.overhang >= 0) ? o.overhang : 0.3;
  const includeRoof = (o.includeRoof !== false);
  const includeFloors = (o.includeFloors !== false);

  const meshes = [];
  const anatomy = { walls: [], floors: [], roof: null };

  // Per storey:
  //   • floor slab at y = storey * wh - floorTh (slab fills [storey*wh - floorTh, storey*wh])
  //   • walls along each polygon edge, base at y = storey * wh
  //
  // The slab uses createFloor() which extrudes downward from y=0; we
  // translate the resulting mesh up by storey*wh + (or simply set
  // mesh.position.y).
  for (let s = 0; s < nFloors; s++) {
    const baseY = s * wh;
    if (includeFloors) {
      const floor = createFloor(pts, floorTh);
      floor.position.y = baseY;
      // Re-encode polygon offset into userData so the inspector reads true Y.
      floor.userData.archdiscStudioArchFloor.storey = s;
      floor.userData.archdiscStudioArchFloor.baseY = baseY;
      floor.updateMatrixWorld(true);
      meshes.push(floor);
      anatomy.floors.push(floor.uuid);
    }

    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length;
      const p1 = [pts[i][0], baseY, pts[i][1]];
      const p2 = [pts[j][0], baseY, pts[j][1]];
      const wall = createWall(p1, p2, wh, wallTh);
      // createWall flattens to y=0; we offset to baseY here.
      wall.position.y += baseY;
      wall.userData.archdiscStudioArchWall.storey = s;
      wall.userData.archdiscStudioArchWall.baseY = baseY;
      wall.updateMatrixWorld(true);
      meshes.push(wall);
      anatomy.walls.push(wall.uuid);
    }
  }

  if (includeRoof) {
    const roof = createGableRoof(pts, ridgeH, overhang);
    // createGableRoof places the eave plane at y=0; lift it to the
    // top-most floor's roof level.
    roof.position.y = nFloors * wh;
    roof.userData.archdiscStudioArchRoof.baseY = nFloors * wh;
    roof.updateMatrixWorld(true);
    meshes.push(roof);
    anatomy.roof = roof.uuid;
  }

  const uuids = meshes.map((m) => m.uuid);
  return { meshes, uuids, anatomy };
}

function _coerce(polygon) {
  if (!Array.isArray(polygon)) return [];
  const out = [];
  for (const p of polygon) {
    if (Array.isArray(p) && p.length >= 2) {
      out.push([Number(p[0]) || 0, Number(p[1]) || 0]);
    } else if (p && typeof p === 'object') {
      const x = (typeof p.x === 'number') ? p.x : 0;
      const z = (typeof p.z === 'number') ? p.z : (typeof p.y === 'number' ? p.y : 0);
      out.push([x, z]);
    }
  }
  if (out.length >= 2) {
    const f = out[0], l = out[out.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-6 && Math.abs(f[1] - l[1]) < 1e-6) out.pop();
  }
  return out;
}
