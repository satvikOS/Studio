// ArchDisc Studio V3 — voxel → Wavefront OBJ + Stanford PLY exporters.
//
// Both exporters skip interior faces (same culling as mesh.js) so the
// resulting files are compact enough to drop straight into Blender /
// Maya / DCCs without re-meshing. They are pure functions of the
// Volume + palette + cellSize triple; no scene / window dependency, so
// they can be unit-tested headless.
//
// OBJ: emits one vertex per (x,y,z) corner + faces. We do NOT emit
// per-vertex colours because OBJ has no portable colour spec; instead
// we emit one material per palette index in an inline `usemtl` group
// so downstream tools can paint each group from the .mtl.
//
// PLY: ASCII Stanford PLY with per-vertex `red green blue` properties
// in [0..255]. Easier than OBJ for hobbyist tools that don't read MTL.

import { FACES as FACE_TABLE } from './mesh.js';
import { getPaletteRGB } from './palette.js';

/**
 * @param {import('./volume.js').Volume} volume
 * @param {number} cellSize
 * @returns {string} OBJ text
 */
export function exportObj(volume, cellSize) {
  if (!volume) return '';
  const cs = Number(cellSize) > 0 ? cellSize : 0.1;
  const offX = -volume.sizeX * cs * 0.5;
  const offY = -volume.sizeY * cs * 0.5;
  const offZ = -volume.sizeZ * cs * 0.5;
  const lines = [
    '# ArchDisc Studio V3 — voxel export',
    `# size ${volume.sizeX} x ${volume.sizeY} x ${volume.sizeZ}`,
    `# voxels ${volume.filled}`,
  ];

  // Group faces by palette index so we can emit a single `usemtl` per
  // group — keeps the OBJ tidy in DCCs.
  const facesByIdx = new Map();
  let vCount = 0;
  const verts = []; // string lines for "v x y z"

  // Helper: ensure a vertex exists at (vx,vy,vz), returns the 1-based
  // OBJ vertex index. We dedupe via a key string — typical voxel meshes
  // are tiny enough that a Map is plenty.
  const vertKey = new Map();
  function pushVert(vx, vy, vz) {
    const k = `${vx}|${vy}|${vz}`;
    let id = vertKey.get(k);
    if (id != null) return id;
    vCount++;
    id = vCount;
    vertKey.set(k, id);
    verts.push(`v ${formatNum(vx)} ${formatNum(vy)} ${formatNum(vz)}`);
    return id;
  }

  volume.forEach((x, y, z, pIdx) => {
    const baseX = offX + x * cs;
    const baseY = offY + y * cs;
    const baseZ = offZ + z * cs;
    for (let f = 0; f < 6; f++) {
      const face = FACE_TABLE[f];
      if (volume.get(x + face.n[0], y + face.n[1], z + face.n[2]) !== 0) continue;
      const ids = new Array(4);
      for (let v = 0; v < 4; v++) {
        const c = face.corners[v];
        ids[v] = pushVert(baseX + c[0] * cs, baseY + c[1] * cs, baseZ + c[2] * cs);
      }
      if (!facesByIdx.has(pIdx)) facesByIdx.set(pIdx, []);
      facesByIdx.get(pIdx).push(`f ${ids[0]} ${ids[1]} ${ids[2]} ${ids[3]}`);
    }
  });

  lines.push(...verts);
  lines.push('');
  for (const [pIdx, fLines] of facesByIdx.entries()) {
    lines.push(`g voxel_palette_${pIdx}`);
    lines.push(`usemtl pal_${pIdx}`);
    lines.push(...fLines);
  }
  return lines.join('\n') + '\n';
}

/**
 * Stanford PLY (ASCII) with per-vertex RGB colour. Each emitted face
 * tags its four corners with the palette colour of the originating
 * voxel — when two adjacent voxels share a corner with different
 * palettes, the *first* writer wins (consistent with the natural
 * forEach() traversal order in volume.js).
 */
export function exportPly(volume, cellSize) {
  if (!volume) return '';
  const cs = Number(cellSize) > 0 ? cellSize : 0.1;
  const offX = -volume.sizeX * cs * 0.5;
  const offY = -volume.sizeY * cs * 0.5;
  const offZ = -volume.sizeZ * cs * 0.5;

  const verts = [];                 // strings "x y z r g b"
  const faces = [];                 // strings "4 a b c d"
  const vertKey = new Map();        // key → 0-based vertex id

  function pushVert(vx, vy, vz, r255, g255, b255) {
    const k = `${vx}|${vy}|${vz}`;
    let id = vertKey.get(k);
    if (id != null) return id;
    id = verts.length;
    vertKey.set(k, id);
    verts.push(`${formatNum(vx)} ${formatNum(vy)} ${formatNum(vz)} ${r255} ${g255} ${b255}`);
    return id;
  }

  volume.forEach((x, y, z, pIdx) => {
    const rgb = getPaletteRGB(pIdx);
    const r255 = Math.round(rgb[0] * 255);
    const g255 = Math.round(rgb[1] * 255);
    const b255 = Math.round(rgb[2] * 255);
    const baseX = offX + x * cs;
    const baseY = offY + y * cs;
    const baseZ = offZ + z * cs;
    for (let f = 0; f < 6; f++) {
      const face = FACE_TABLE[f];
      if (volume.get(x + face.n[0], y + face.n[1], z + face.n[2]) !== 0) continue;
      const ids = new Array(4);
      for (let v = 0; v < 4; v++) {
        const c = face.corners[v];
        ids[v] = pushVert(
          baseX + c[0] * cs, baseY + c[1] * cs, baseZ + c[2] * cs,
          r255, g255, b255,
        );
      }
      faces.push(`4 ${ids[0]} ${ids[1]} ${ids[2]} ${ids[3]}`);
    }
  });

  const header = [
    'ply',
    'format ascii 1.0',
    'comment ArchDisc Studio V3 voxel export',
    `element vertex ${verts.length}`,
    'property float x',
    'property float y',
    'property float z',
    'property uchar red',
    'property uchar green',
    'property uchar blue',
    `element face ${faces.length}`,
    'property list uchar int vertex_indices',
    'end_header',
  ];
  return header.concat(verts, faces).join('\n') + '\n';
}

function formatNum(n) {
  // Six-decimal place is plenty for voxel work and keeps the OBJ file
  // size reasonable. Trim trailing zeros for tidiness.
  return Number.isInteger(n) ? String(n) : Number(n.toFixed(6)).toString();
}

export default exportObj;
