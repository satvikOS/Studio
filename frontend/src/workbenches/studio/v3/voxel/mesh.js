// ArchDisc Studio V3 — voxel volume → merged THREE.Mesh.
//
// MagicaVoxel-style mesher. We walk every filled cell in the Volume,
// and for each of its 6 faces we emit a unit quad only when the
// neighbour on that side is empty. This is the classic "interior face
// culling" trick — for a solid 32^3 cube we go from 6*32^3 = 196k
// faces down to 6*32^2 = 6.1k, roughly a 32x win.
//
// Output is a single non-indexed BufferGeometry with positions,
// normals, and per-vertex colours sourced from the palette. The
// returned THREE.Mesh uses MeshStandardMaterial with `vertexColors`
// enabled so the palette colour shows up under any Studio lighting
// rig.
//
// The mesh is centred at the origin in object space — the volume sits
// in [-W/2 .. +W/2] (where W = sizeX * cellSize) on each axis. Callers
// place the mesh wherever they like via mesh.position.

import * as THREE from 'three';

// Face direction definitions. For each axis-aligned face we store:
//   • the neighbour offset (dx,dy,dz) — used to test if the face is
//     interior (skip) or exterior (emit)
//   • the four corner offsets in local cell space, in CCW winding when
//     viewed from outside the cube (so the auto-computed normal points
//     out)
//   • the outward-facing normal
// Exported so exportObj.js can share the face table without a separate
// helper module — keeps the file count in line with the slice brief.
export const FACES = [
  // +X face
  {
    n: [1, 0, 0],
    corners: [
      [1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1],
    ],
  },
  // -X face
  {
    n: [-1, 0, 0],
    corners: [
      [0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0],
    ],
  },
  // +Y face (top)
  {
    n: [0, 1, 0],
    corners: [
      [0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0],
    ],
  },
  // -Y face (bottom)
  {
    n: [0, -1, 0],
    corners: [
      [0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1],
    ],
  },
  // +Z face
  {
    n: [0, 0, 1],
    corners: [
      [1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1],
    ],
  },
  // -Z face
  {
    n: [0, 0, -1],
    corners: [
      [0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0],
    ],
  },
];

/**
 * Build a THREE.Mesh from a Volume + palette.
 *
 * @param {import('./volume.js').Volume} volume
 * @param {Array<[r,g,b]>} paletteRGB  array of normalized [r,g,b] tuples
 *                                    (e.g. from palette.getPalette()).
 * @param {number} cellSize           world-units per voxel edge.
 * @returns {THREE.Mesh}
 */
export function rebuildMesh(volume, paletteRGB, cellSize) {
  const cs = Number(cellSize) > 0 ? cellSize : 0.1;
  if (!volume) {
    return makeEmptyMesh();
  }

  // Pre-size the typed arrays. Worst case = every filled cell shows all
  // 6 faces. That's 6 * 4 verts * 3 floats per face = 72 floats/voxel
  // for positions; we trim with subarray() at the end.
  const cap = volume.filled || 0;
  const POS = new Float32Array(cap * 72);
  const NRM = new Float32Array(cap * 72);
  const COL = new Float32Array(cap * 72);
  const IDX = new Uint32Array(cap * 36); // 6 faces * 6 indices

  let posOff = 0;     // float cursor
  let nrmOff = 0;
  let colOff = 0;
  let idxOff = 0;     // index cursor (uint32)
  let vertCount = 0;

  // Centre the volume at the origin so the mesh sits where the user
  // expects when they drop it into the scene.
  const offX = -volume.sizeX * cs * 0.5;
  const offY = -volume.sizeY * cs * 0.5;
  const offZ = -volume.sizeZ * cs * 0.5;

  volume.forEach((x, y, z, pIdx) => {
    const rgb = paletteRGB && paletteRGB[pIdx] ? paletteRGB[pIdx] : [1, 0, 1]; // magenta fallback
    const r = rgb[0], g = rgb[1], b = rgb[2];
    const baseX = offX + x * cs;
    const baseY = offY + y * cs;
    const baseZ = offZ + z * cs;

    for (let f = 0; f < 6; f++) {
      const face = FACES[f]; // eslint-disable-line no-use-before-define
      // Interior cull: skip face if the neighbour is also filled.
      if (volume.get(x + face.n[0], y + face.n[1], z + face.n[2]) !== 0) continue;

      const startVert = vertCount;
      for (let v = 0; v < 4; v++) {
        const c = face.corners[v];
        POS[posOff++] = baseX + c[0] * cs;
        POS[posOff++] = baseY + c[1] * cs;
        POS[posOff++] = baseZ + c[2] * cs;
        NRM[nrmOff++] = face.n[0];
        NRM[nrmOff++] = face.n[1];
        NRM[nrmOff++] = face.n[2];
        COL[colOff++] = r;
        COL[colOff++] = g;
        COL[colOff++] = b;
      }
      // Two CCW triangles per quad: 0-1-2 + 0-2-3.
      IDX[idxOff++] = startVert + 0;
      IDX[idxOff++] = startVert + 1;
      IDX[idxOff++] = startVert + 2;
      IDX[idxOff++] = startVert + 0;
      IDX[idxOff++] = startVert + 2;
      IDX[idxOff++] = startVert + 3;
      vertCount += 4;
    }
  });

  const geo = new THREE.BufferGeometry();
  if (vertCount === 0) {
    return makeEmptyMesh();
  }
  geo.setAttribute('position', new THREE.BufferAttribute(POS.subarray(0, vertCount * 3), 3));
  geo.setAttribute('normal',   new THREE.BufferAttribute(NRM.subarray(0, vertCount * 3), 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(COL.subarray(0, vertCount * 3), 3));
  geo.setIndex(new THREE.BufferAttribute(IDX.subarray(0, idxOff), 1));
  geo.computeBoundingBox();
  geo.computeBoundingSphere();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.78,
    metalness: 0.0,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = 'voxel-volume';
  mesh.userData = mesh.userData || {};
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'voxel-volume';
  mesh.userData.archdiscStudioVoxelStats = {
    voxels: volume.filled,
    verts: vertCount,
    cellSize: cs,
    sizeX: volume.sizeX, sizeY: volume.sizeY, sizeZ: volume.sizeZ,
  };
  return mesh;
}

function makeEmptyMesh() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
  const m = new THREE.Mesh(geo, mat);
  m.name = 'voxel-volume-empty';
  m.userData.archdiscStudioPrimitive = true;
  m.userData.archdiscStudioPrimitiveKind = 'voxel-volume';
  m.userData.archdiscStudioVoxelStats = { voxels: 0, verts: 0 };
  return m;
}

export default rebuildMesh;
