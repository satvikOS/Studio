// ArchDisc Studio V3 — SketchUp-style floor slab.
//
// createFloor() takes a polygon describing the floor outline in world
// XZ coordinates and extrudes it downward (or upward) by `thickness`.
// Returns a THREE.Mesh sitting flush with the y=0 ground plane: the
// top face of the slab is at y=0 and the bottom face is at y=-thickness.
//
// We accept the polygon either as an array of [x,z] pairs or an array
// of {x,z} objects (or Vector3-like — y is ignored).
//
// Implementation uses THREE.Shape + ExtrudeGeometry so any convex or
// concave outline works. We post-rotate the extruded shape so its
// extrusion axis (which Shape extrudes along +Z by default) becomes
// world -Y.

import * as THREE from 'three';

/**
 * @param {Array<[number,number] | {x,z}>} polygon — XZ outline, closed (last == first optional)
 * @param {number} thickness — slab thickness in metres (default 0.2)
 * @returns {THREE.Mesh}
 */
export function createFloor(polygon, thickness) {
  const th = (typeof thickness === 'number' && isFinite(thickness) && thickness > 0) ? thickness : 0.2;
  const pts = _coerce(polygon);
  if (pts.length < 3) throw new Error('createFloor: need at least 3 polygon points');

  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();

  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: th,
    bevelEnabled: false,
    steps: 1,
  });
  // Shape lives in the XY plane and extrudes along +Z. Rotate so XY
  // becomes XZ (i.e. the floor sits on the ground) and extrusion
  // becomes downward.
  geo.rotateX(Math.PI * 0.5);
  // After this rotation the slab occupies y ∈ [-th, 0] when the
  // polygon points were specified as (x, z). Translate so the TOP
  // face sits at y = 0 (which it already does after rotateX(+PI/2)
  // because Shape extrudes into +Z then we send +Z → -Y; the polygon
  // plane (z=0) becomes y=0 and the extruded face (z=th) becomes
  // y=-th).

  const mat = new THREE.MeshStandardMaterial({
    color: 0x8b6f4e,
    roughness: 0.85,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.name = 'arch-floor';
  mesh.userData = {
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: 'arch-floor',
    archdiscStudioArchFloor: {
      polygon: pts.map(([x, z]) => [x, z]),
      thickness: th,
    },
  };
  mesh.updateMatrixWorld(true);
  return mesh;
}

function _coerce(polygon) {
  if (!Array.isArray(polygon)) return [];
  const out = [];
  for (const p of polygon) {
    if (Array.isArray(p) && p.length >= 2) {
      out.push([Number(p[0]) || 0, Number(p[1]) || 0]);
    } else if (p && typeof p === 'object') {
      // {x, z} or {x, y, z} — y ignored.
      const x = (typeof p.x === 'number') ? p.x : 0;
      const z = (typeof p.z === 'number') ? p.z : (typeof p.y === 'number' ? p.y : 0);
      out.push([x, z]);
    }
  }
  // Drop a trailing duplicate (closed polygon) so ExtrudeGeometry
  // doesn't see a zero-length segment.
  if (out.length >= 2) {
    const f = out[0], l = out[out.length - 1];
    if (Math.abs(f[0] - l[0]) < 1e-6 && Math.abs(f[1] - l[1]) < 1e-6) out.pop();
  }
  return out;
}

/**
 * Compute the area of an XZ polygon — used by the building generator
 * to size the roof to its footprint without recomputing the bbox.
 */
export function polygonArea(polygon) {
  const pts = _coerce(polygon);
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i][0] * pts[j][1] - pts[j][0] * pts[i][1];
  }
  return Math.abs(a) * 0.5;
}
