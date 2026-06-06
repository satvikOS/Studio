// ArchDisc Studio V3 — Geometry-Nodes 2 / RealizeInstances (slice 757).
//
// Blender Geometry Nodes' "Realize Instances" SOP. Bakes a
// THREE.InstancedMesh into a single THREE.BufferGeometry by walking
// each instance matrix, transforming a clone of the source positions
// (and normals) into world-instance space, then concatenating
// everything into one giant non-indexed buffer.
//
// The realized geometry can then flow through edit ops that don't
// understand InstancedMesh (booleans, modifiers, displacement, etc.).

import * as THREE from 'three';

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();

// realizeInstances(instancedMesh)
//   instancedMesh: THREE.InstancedMesh
//   returns: { geometry: THREE.BufferGeometry, count: number, vertsPerInstance: number }
export function realizeInstances(instancedMesh) {
  if (!instancedMesh || !instancedMesh.isInstancedMesh) return null;
  const src = instancedMesh.geometry;
  if (!src || !src.attributes || !src.attributes.position) return null;

  // Work from non-indexed positions so we can concat blindly without
  // managing index offsets.
  const flat = src.index ? src.toNonIndexed() : src.clone();
  const srcPos = flat.attributes.position;
  const srcNrm = flat.attributes.normal || null;
  const vertsPer = srcPos.count;
  const count = instancedMesh.count | 0;
  if (count <= 0 || vertsPer === 0) {
    try { flat.dispose && flat.dispose(); } catch (_) {}
    return { geometry: new THREE.BufferGeometry(), count: 0, vertsPerInstance: 0 };
  }

  const totalVerts = vertsPer * count;
  const outPos = new Float32Array(totalVerts * 3);
  const outNrm = srcNrm ? new Float32Array(totalVerts * 3) : null;

  const mat = new THREE.Matrix4();
  const nMat = new THREE.Matrix3();
  let writeP = 0, writeN = 0;
  for (let i = 0; i < count; i++) {
    instancedMesh.getMatrixAt(i, mat);
    if (outNrm) nMat.getNormalMatrix(mat);
    for (let v = 0; v < vertsPer; v++) {
      _v.set(srcPos.getX(v), srcPos.getY(v), srcPos.getZ(v)).applyMatrix4(mat);
      outPos[writeP++] = _v.x;
      outPos[writeP++] = _v.y;
      outPos[writeP++] = _v.z;
      if (outNrm) {
        _n.set(srcNrm.getX(v), srcNrm.getY(v), srcNrm.getZ(v)).applyMatrix3(nMat).normalize();
        outNrm[writeN++] = _n.x;
        outNrm[writeN++] = _n.y;
        outNrm[writeN++] = _n.z;
      }
    }
  }

  try { flat.dispose && flat.dispose(); } catch (_) {}

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  if (outNrm) out.setAttribute('normal', new THREE.BufferAttribute(outNrm, 3));
  else out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();
  return { geometry: out, count, vertsPerInstance: vertsPer };
}

export default realizeInstances;
