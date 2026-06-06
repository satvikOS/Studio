// ArchDisc Studio V3 — Geometry-Nodes 2 / InstanceOnPoints (slice 757).
//
// Blender Geometry Nodes' "Instance on Points" SOP. Given a source mesh
// and an array of points (with optional per-point normal), build a
// single THREE.InstancedMesh so the source geometry is replicated at
// each point with a normal-aligned orientation. The source's local
// rotation/scale is composed onto each instance's basis so users keep
// authoring the prototype like a regular mesh.
//
// Pure JS, no external deps beyond three. Matches Blender's behaviour:
// rotation is computed from the point's "up" normal (default world Y).

import * as THREE from 'three';

const _DEFAULT_UP = new THREE.Vector3(0, 1, 0);

// Build a Matrix4 that aligns the canonical (0,1,0) up vector with
// `normal` and places the basis at `position`, then composes the
// source mesh's quaternion + scale on top so the prototype's own
// transform survives.
function _matrixForPoint(position, normal, baseQuat, baseScale, scale) {
  const m = new THREE.Matrix4();
  const n = new THREE.Vector3(normal[0], normal[1], normal[2]);
  if (n.lengthSq() < 1e-12) n.set(0, 1, 0);
  else n.normalize();
  // Quaternion that rotates +Y → n.
  const q = new THREE.Quaternion().setFromUnitVectors(_DEFAULT_UP, n);
  if (baseQuat) q.multiply(baseQuat);
  const s = new THREE.Vector3(
    (baseScale ? baseScale.x : 1) * scale,
    (baseScale ? baseScale.y : 1) * scale,
    (baseScale ? baseScale.z : 1) * scale,
  );
  const p = new THREE.Vector3(position[0], position[1], position[2]);
  m.compose(p, q, s);
  return m;
}

// instanceOnPoints(sourceMesh, points, opts)
//   sourceMesh: THREE.Mesh whose geometry+material are replicated
//   points:     Array<{ pos:[x,y,z], normal?:[x,y,z] }>
//   opts:       { scale?: number, name?: string }
//
// Returns a THREE.InstancedMesh ready for scene.add(). The caller is
// responsible for adding to the scene and disposing if needed.
export function instanceOnPoints(sourceMesh, points, opts) {
  if (!sourceMesh || !sourceMesh.geometry) return null;
  const pts = Array.isArray(points) ? points : [];
  const count = pts.length;
  if (count === 0) return null;
  const o = opts || {};
  const scale = Number.isFinite(+o.scale) ? +o.scale : 1;

  // Clone the source geometry so we own it (the original mesh keeps
  // its geometry untouched). The material is shared by reference —
  // matches Blender's instancing semantics.
  const geo = sourceMesh.geometry.clone();
  const mat = sourceMesh.material || new THREE.MeshStandardMaterial({ color: 0x9aa6b2 });

  const inst = new THREE.InstancedMesh(geo, mat, count);
  inst.name = o.name || `${sourceMesh.name || 'mesh'}-instances`;

  const baseQuat = sourceMesh.quaternion ? sourceMesh.quaternion.clone() : null;
  const baseScale = sourceMesh.scale ? sourceMesh.scale.clone() : null;

  for (let i = 0; i < count; i++) {
    const p = pts[i] || {};
    const pos = Array.isArray(p.pos) ? p.pos : [0, 0, 0];
    const nrm = Array.isArray(p.normal) ? p.normal : [0, 1, 0];
    const m = _matrixForPoint(pos, nrm, baseQuat, baseScale, scale);
    inst.setMatrixAt(i, m);
  }
  inst.instanceMatrix.needsUpdate = true;

  inst.userData = inst.userData || {};
  inst.userData.archdiscStudioPrimitive = true;
  inst.userData.archdiscStudioPrimitiveKind = 'instances';
  inst.userData.archdiscStudioGeomNodes2 = 'instanceOnPoints';
  inst.userData.archdiscStudioGN2SourceUuid = sourceMesh.uuid;
  inst.userData.archdiscStudioGN2Points = pts.slice();
  inst.castShadow = true;
  inst.receiveShadow = true;
  return inst;
}

export default instanceOnPoints;
