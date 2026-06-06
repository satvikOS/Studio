// ArchDisc Studio V3 — Geometry-Nodes 2 / TransformGeometry (slice 757).
//
// Blender Geometry Nodes' "Transform Geometry" SOP. Bakes a Matrix4
// directly into a mesh's position attribute. Unlike Object.applyMatrix4
// which composes onto the mesh's own transform, this rewrites the
// vertex buffer so the mesh's position / rotation / scale stay at
// their identity values while the geometry sits at the new pose.
//
// Useful when chaining ops that expect world-space geometry (CSG,
// remesh, baking) without losing the original pivot of the Mesh node.

import * as THREE from 'three';

// transformGeometry(geometry, matrix4)
//   geometry: THREE.BufferGeometry (mutated in place — caller's choice)
//   matrix4:  THREE.Matrix4 OR length-16 number[] in column-major order
//             (matches THREE.Matrix4.elements, also matches Object3D's
//             matrix.toArray()).
//   returns:  { ok: true, vertices: number }
//
// Position attribute is rewritten in place. Normals are re-derived
// from the upper-3x3 (so non-uniform scales work) and stored back. If
// the geometry had no normal attribute, we leave it absent — caller
// can computeVertexNormals() if they want one.
export function transformGeometry(geometry, matrix4) {
  if (!geometry || !geometry.attributes || !geometry.attributes.position) {
    return { ok: false, error: 'no geometry' };
  }
  let m;
  if (matrix4 && matrix4.isMatrix4) {
    m = matrix4;
  } else if (Array.isArray(matrix4) && matrix4.length === 16) {
    m = new THREE.Matrix4().fromArray(matrix4);
  } else {
    return { ok: false, error: 'bad matrix' };
  }

  const pos = geometry.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(m);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;

  // Rotate normals through the normal matrix so non-uniform scales
  // stay consistent. Bake into the existing normal attribute.
  const nrm = geometry.attributes.normal;
  if (nrm) {
    const nMat = new THREE.Matrix3().getNormalMatrix(m);
    const n = new THREE.Vector3();
    for (let i = 0; i < nrm.count; i++) {
      n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i)).applyMatrix3(nMat).normalize();
      nrm.setXYZ(i, n.x, n.y, n.z);
    }
    nrm.needsUpdate = true;
  }

  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { ok: true, vertices: pos.count };
}

export default transformGeometry;
