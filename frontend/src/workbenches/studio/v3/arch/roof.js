// ArchDisc Studio V3 — SketchUp-style gable roof.
//
// createGableRoof() takes an XZ-plane footprint polygon and builds a
// classic two-pitch (A-frame) roof above it. We:
//
//   1. Compute the polygon's axis-aligned bounding rectangle (xmin,
//      zmin, xmax, zmax) and inflate it by `overhang`.
//   2. Pick the long axis as the ridge direction (the side along which
//      the peak runs). The two gable ends are the short sides.
//   3. Build a triangular prism whose base lies at y=wallHeight (or
//      whatever the polygon's source height was — we pass 0 internally
//      since the caller positions the roof at the right Y by placing
//      the returned mesh) and whose ridge sits ridgeHeight above the
//      base.
//
// Returns a THREE.Mesh. The mesh's userData carries the raw bounding
// rect + ridge data so the building generator can stack it on top of
// the walls without re-deriving the geometry.

import * as THREE from 'three';

/**
 * @param {Array<[number,number] | {x,z}>} footprint — XZ outline
 * @param {number} ridgeHeight — vertical distance from base to peak
 * @param {number} overhang — eaves overhang in metres (default 0.3)
 * @returns {THREE.Mesh}
 */
export function createGableRoof(footprint, ridgeHeight, overhang) {
  const pts = _coerce(footprint);
  if (pts.length < 3) throw new Error('createGableRoof: need at least 3 polygon points');
  const ridge = (typeof ridgeHeight === 'number' && isFinite(ridgeHeight) && ridgeHeight > 0) ? ridgeHeight : 1.6;
  const oh = (typeof overhang === 'number' && isFinite(overhang) && overhang >= 0) ? overhang : 0.3;

  // Bounding rect of footprint.
  let xmin = Infinity, xmax = -Infinity, zmin = Infinity, zmax = -Infinity;
  for (const [x, z] of pts) {
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
  }
  xmin -= oh; xmax += oh; zmin -= oh; zmax += oh;
  const dx = xmax - xmin;
  const dz = zmax - zmin;
  if (dx < 1e-3 || dz < 1e-3) throw new Error('createGableRoof: degenerate footprint');

  // Ridge runs along the longer axis. So short axis is the half-width
  // and the gable peaks are at the midpoint of the long axis ends.
  const ridgeAlongX = dx >= dz;
  // Geometry construction: 6 vertices of a triangular prism.
  //   Eave verts at base (y=0):
  //     v0 = (xmin, 0, zmin)
  //     v1 = (xmax, 0, zmin)
  //     v2 = (xmax, 0, zmax)
  //     v3 = (xmin, 0, zmax)
  //   Ridge verts at y=ridge:
  //     if ridgeAlongX: ridge runs in x; peaks centred on z
  //       v4 = (xmin, ridge, (zmin+zmax)/2)
  //       v5 = (xmax, ridge, (zmin+zmax)/2)
  //     else: ridge runs in z; peaks centred on x
  //       v4 = ((xmin+xmax)/2, ridge, zmin)
  //       v5 = ((xmin+xmax)/2, ridge, zmax)
  //
  // Faces:
  //   Two slanted roof planes (each a quad → 2 triangles).
  //   Two gable end triangles (closing the prism so it's watertight).
  //   No bottom face — the walls sit beneath it.
  const cx = (xmin + xmax) * 0.5;
  const cz = (zmin + zmax) * 0.5;
  let v0, v1, v2, v3, v4, v5;
  v0 = [xmin, 0, zmin];
  v1 = [xmax, 0, zmin];
  v2 = [xmax, 0, zmax];
  v3 = [xmin, 0, zmax];
  if (ridgeAlongX) {
    v4 = [xmin, ridge, cz];
    v5 = [xmax, ridge, cz];
  } else {
    v4 = [cx, ridge, zmin];
    v5 = [cx, ridge, zmax];
  }

  const positions = new Float32Array(6 * 3);
  const setV = (i, v) => {
    positions[i * 3 + 0] = v[0];
    positions[i * 3 + 1] = v[1];
    positions[i * 3 + 2] = v[2];
  };
  setV(0, v0); setV(1, v1); setV(2, v2); setV(3, v3);
  setV(4, v4); setV(5, v5);

  // Index buffer.
  let index;
  if (ridgeAlongX) {
    // Front slope: v0-v1-v5-v4 (quad over z=zmin side rising to ridge)
    // Back slope:  v3-v4-v5-v2 (over z=zmax side)
    // Gable -x:    v0-v4-v3
    // Gable +x:    v1-v2-v5
    index = new Uint32Array([
      // front slope
      0, 1, 5,  0, 5, 4,
      // back slope (CCW from outside)
      3, 4, 5,  3, 5, 2,
      // -x gable
      0, 4, 3,
      // +x gable
      1, 2, 5,
    ]);
  } else {
    // Ridge along Z. Now the long axis is z; slopes face -x and +x.
    // Slope -x: v0-v4-v5-v3 (face on xmin side rising to ridge in z)
    // Slope +x: v1-v2-v5-v4
    // Gable -z (zmin): v0-v1-v4
    // Gable +z (zmax): v3-v5-v2
    index = new Uint32Array([
      // -x slope
      0, 4, 5,  0, 5, 3,
      // +x slope
      1, 2, 5,  1, 5, 4,
      // -z gable
      0, 1, 4,
      // +z gable
      3, 5, 2,
    ]);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeVertexNormals();
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    color: 0x6b3a2a,
    roughness: 0.7,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'arch-roof';
  mesh.userData = {
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: 'arch-roof',
    archdiscStudioArchRoof: {
      bounds: { xmin, xmax, zmin, zmax },
      ridgeHeight: ridge,
      overhang: oh,
      ridgeAlongX,
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
