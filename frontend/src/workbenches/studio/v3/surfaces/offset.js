// ArchDisc Studio V3 — Plasticity-style offset surface.
//
// Duplicate the source mesh, push every vert along its smoothed vertex
// normal by `distance`, place the result as a NEW mesh in the scene.
// The original mesh is left untouched (parity with Plasticity / MoI
// "Offset surface" — it's a constructor, not a mutator). Useful as a
// stand-alone op AND as the building block for shell().
//
// Returns: { ok, uuid, distance, verts, tris } or { ok:false, error }.

import * as THREE from 'three';
import {
  findMeshByUuid,
  pushUndo,
  ensureIndexed,
  copyVerts,
  copyIdx,
  perVertexNormals,
} from './common.js';

export function offsetSurface(meshUuid, distance, opts) {
  const mesh = findMeshByUuid(meshUuid);
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) {
    return { ok: false, error: 'no mesh for uuid' };
  }
  const d = Number.isFinite(+distance) ? +distance : 0.05;
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const inVerts = copyVerts(geo.attributes.position);
  const inIdx = copyIdx(geo.index);
  const normals = perVertexNormals(inVerts, inIdx);

  const outVerts = new Float32Array(inVerts.length);
  for (let i = 0; i < inVerts.length / 3; i++) {
    outVerts[i * 3]     = inVerts[i * 3]     + normals[i * 3]     * d;
    outVerts[i * 3 + 1] = inVerts[i * 3 + 1] + normals[i * 3 + 1] * d;
    outVerts[i * 3 + 2] = inVerts[i * 3 + 2] + normals[i * 3 + 2] * d;
  }
  // Index unchanged.
  const idxArr = new Uint32Array(inIdx);

  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(outVerts, 3));
  newGeo.setIndex(
    idxArr.length > 65535
      ? new THREE.Uint32BufferAttribute(idxArr, 1)
      : new THREE.Uint16BufferAttribute(idxArr, 1),
  );
  newGeo.computeVertexNormals();
  newGeo.computeBoundingBox();
  newGeo.computeBoundingSphere();

  const sourceMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const material = sourceMat && sourceMat.clone
    ? sourceMat.clone()
    : new THREE.MeshStandardMaterial({ color: 0x97a4b1, metalness: 0.18, roughness: 0.6 });
  // Mark offsets visually distinct so a designer can tell them apart.
  if (material && material.color && (!opts || opts.tintOffset !== false)) {
    try { material.color.offsetHSL(0, 0.05, 0.05); } catch (_) {}
  }
  const out = new THREE.Mesh(newGeo, material);
  out.castShadow = true;
  out.receiveShadow = true;
  out.position.copy(mesh.position);
  out.quaternion.copy(mesh.quaternion);
  out.scale.copy(mesh.scale);
  out.name = `${mesh.name || 'mesh'}_offset`;
  out.userData = {
    ...mesh.userData,
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: 'surface-offset',
    archdiscStudioOffsetFrom: mesh.uuid,
    archdiscStudioOffsetDistance: d,
  };
  // Preserve picking.
  out.userData.pickable = true;

  const parent = mesh.parent
    || (typeof window !== 'undefined' && window.__archdiscScene)
    || (typeof window !== 'undefined' && window.__archdiscViewport
        && window.__archdiscViewport.scene);
  if (parent && parent.add) parent.add(out);

  return {
    ok: true,
    uuid: out.uuid,
    sourceUuid: mesh.uuid,
    distance: d,
    verts: outVerts.length / 3,
    tris: idxArr.length / 3,
  };
}

export default offsetSurface;
