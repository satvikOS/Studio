// ArchDisc Studio V3 — Plasticity-style shell.
//
// A shell is a thick-walled solid built from:
//   1. the original mesh (outer surface, original winding)
//   2. an offset mesh pushed inward by `thickness` (inner surface,
//      flipped winding so its normals face outward into the shell)
//   3. side walls bridging every boundary edge of the original to the
//      matching boundary edge on the offset (closed loop quads)
//
// For a CLOSED mesh (e.g. a cube), step 3 contributes zero walls because
// there are no boundary edges; the result is still a valid hollow solid
// once the inner surface flips winding. For an OPEN mesh (e.g. a plane
// with a hole), the walls fill in the rim — giving a Plasticity-style
// "Make hollow" result.
//
// Returns: { ok, uuid, thickness, verts, tris, walls } or { ok:false }.

import * as THREE from 'three';
import {
  findMeshByUuid,
  pushUndo,
  ensureIndexed,
  copyVerts,
  copyIdx,
  perVertexNormals,
  boundaryEdges,
} from './common.js';

export function shellSurface(meshUuid, thickness) {
  const mesh = findMeshByUuid(meshUuid);
  if (!mesh || !mesh.geometry || !mesh.geometry.attributes.position) {
    return { ok: false, error: 'no mesh for uuid' };
  }
  const t = Number.isFinite(+thickness) ? +thickness : 0.05;
  pushUndo();

  ensureIndexed(mesh.geometry);
  const geo = mesh.geometry;
  const inVerts = copyVerts(geo.attributes.position);
  const inIdx = copyIdx(geo.index);
  const normals = perVertexNormals(inVerts, inIdx);

  const vcount = inVerts.length / 3;
  // Combined buffer: outer verts [0..vcount-1], inner verts
  // [vcount..2*vcount-1] (pushed INWARD by -t along the smoothed normal).
  const allVerts = new Array(vcount * 6);
  for (let i = 0; i < vcount; i++) {
    allVerts[i * 3]     = inVerts[i * 3];
    allVerts[i * 3 + 1] = inVerts[i * 3 + 1];
    allVerts[i * 3 + 2] = inVerts[i * 3 + 2];
  }
  for (let i = 0; i < vcount; i++) {
    const j = vcount + i;
    allVerts[j * 3]     = inVerts[i * 3]     - normals[i * 3]     * t;
    allVerts[j * 3 + 1] = inVerts[i * 3 + 1] - normals[i * 3 + 1] * t;
    allVerts[j * 3 + 2] = inVerts[i * 3 + 2] - normals[i * 3 + 2] * t;
  }

  // Outer surface keeps the original winding.
  const allIdx = [];
  for (let f = 0; f < inIdx.length; f += 3) {
    allIdx.push(inIdx[f], inIdx[f + 1], inIdx[f + 2]);
  }
  // Inner surface uses the offset verts, FLIPPED winding so its normals
  // point outward into the shell.
  for (let f = 0; f < inIdx.length; f += 3) {
    allIdx.push(
      vcount + inIdx[f + 2],
      vcount + inIdx[f + 1],
      vcount + inIdx[f],
    );
  }

  // Side walls — one quad per boundary edge of the original mesh, drawn
  // outer(a)→outer(b)→inner(b)→inner(a). Only contributes for open meshes.
  const bedges = boundaryEdges(inIdx);
  let walls = 0;
  for (const e of bedges) {
    const a = e.a, b = e.b;
    const ai = a, bi = b, aj = vcount + a, bj = vcount + b;
    allIdx.push(ai, bi, bj);
    allIdx.push(ai, bj, aj);
    walls += 2;
  }

  // Build new geometry.
  const newGeo = new THREE.BufferGeometry();
  newGeo.setAttribute('position', new THREE.Float32BufferAttribute(allVerts, 3));
  newGeo.setIndex(
    allIdx.length > 65535
      ? new THREE.Uint32BufferAttribute(allIdx, 1)
      : new THREE.Uint16BufferAttribute(allIdx, 1),
  );
  newGeo.computeVertexNormals();
  newGeo.computeBoundingBox();
  newGeo.computeBoundingSphere();

  const sourceMat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const material = sourceMat && sourceMat.clone
    ? sourceMat.clone()
    : new THREE.MeshStandardMaterial({ color: 0x9098a5, metalness: 0.18, roughness: 0.55 });
  const out = new THREE.Mesh(newGeo, material);
  out.castShadow = true;
  out.receiveShadow = true;
  out.position.copy(mesh.position);
  out.quaternion.copy(mesh.quaternion);
  out.scale.copy(mesh.scale);
  out.name = `${mesh.name || 'mesh'}_shell`;
  out.userData = {
    ...mesh.userData,
    archdiscStudioPrimitive: true,
    archdiscStudioPrimitiveKind: 'surface-shell',
    archdiscStudioShellFrom: mesh.uuid,
    archdiscStudioShellThickness: t,
  };
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
    thickness: t,
    verts: allVerts.length / 3,
    tris: allIdx.length / 3,
    walls,
    boundaryEdges: bedges.length,
  };
}

export default shellSurface;
