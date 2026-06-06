import * as THREE from 'three';

/*
 * Substance Painter / Marmoset-style bake-to-UV-texture for the
 * WORLD-SPACE POSITION map. For every texel the mesh point is sampled,
 * normalised into the mesh bounding box, and written to RGB:
 *
 *   R = (worldX - bboxMinX) / bboxSizeX
 *   G = (worldY - bboxMinY) / bboxSizeY
 *   B = (worldZ - bboxMinZ) / bboxSizeZ
 *
 * Position maps are debug / source data — they drive smart materials,
 * baked-out wear effects, etc. They are NOT a standard
 * MeshStandardMaterial channel, so the result is stored on
 * `userData.archdiscStudioPositionMap = { texture, bbox, size }` rather
 * than wired to a material slot.
 *
 * Same UV-grid + UV-bbox prefilter + 2D barycentric resolution as
 * bake/aoTexture.js and bake/normalTexture.js.
 */
export function bakePositionToTexture(mesh, opts = {}) {
  const geo = mesh.geometry;
  if (!geo) return { ok: false, error: 'no geometry' };
  const uv = geo.attributes.uv;
  if (!uv) return { ok: false, error: 'mesh has no UV channel' };
  const pos = geo.attributes.position;
  if (!geo.boundingBox) geo.computeBoundingBox();

  const size = (opts.size | 0) || 256;
  const epsilon = 1e-5;

  mesh.updateMatrixWorld(true);

  // World bounding box: re-derive directly so we have it after the
  // matrix-world transform (the local bbox alone wouldn't decode right
  // for a rotated / scaled mesh).
  const wb = new THREE.Box3().setFromObject(mesh);
  const wbMin = wb.min.clone();
  const wbSize = wb.getSize(new THREE.Vector3());
  // Guard against degenerate bbox dims (a perfectly flat mesh).
  const sX = wbSize.x > 1e-9 ? 1 / wbSize.x : 1;
  const sY = wbSize.y > 1e-9 ? 1 / wbSize.y : 1;
  const sZ = wbSize.z > 1e-9 ? 1 / wbSize.z : 1;

  // Build triangles[] with world-space positions per vertex + UV bbox.
  const triangles = [];
  const addTri = (a, b, c) => {
    const uAx = uv.getX(a), uAy = uv.getY(a);
    const uBx = uv.getX(b), uBy = uv.getY(b);
    const uCx = uv.getX(c), uCy = uv.getY(c);
    const pA = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a)).applyMatrix4(mesh.matrixWorld);
    const pB = new THREE.Vector3(pos.getX(b), pos.getY(b), pos.getZ(b)).applyMatrix4(mesh.matrixWorld);
    const pC = new THREE.Vector3(pos.getX(c), pos.getY(c), pos.getZ(c)).applyMatrix4(mesh.matrixWorld);
    triangles.push({
      uAx, uAy, uBx, uBy, uCx, uCy,
      uMin: Math.min(uAx, uBx, uCx), uMax: Math.max(uAx, uBx, uCx),
      vMin: Math.min(uAy, uBy, uCy), vMax: Math.max(uAy, uBy, uCy),
      pA, pB, pC,
    });
  };
  if (geo.index) {
    const idx = geo.index.array;
    for (let i = 0; i < idx.length; i += 3) addTri(idx[i], idx[i + 1], idx[i + 2]);
  } else {
    for (let i = 0; i < pos.count; i += 3) addTri(i, i + 1, i + 2);
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const worldP = new THREE.Vector3();
  let covered = 0;
  for (let y = 0; y < size; y++) {
    const v = 1 - (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      let hitTri = null, w0 = 0, w1 = 0, w2 = 0;
      for (const tri of triangles) {
        if (u < tri.uMin || u > tri.uMax || v < tri.vMin || v > tri.vMax) continue;
        const v0x = tri.uBx - tri.uAx, v0y = tri.uBy - tri.uAy;
        const v1x = tri.uCx - tri.uAx, v1y = tri.uCy - tri.uAy;
        const v2x = u - tri.uAx,       v2y = v - tri.uAy;
        const d00 = v0x * v0x + v0y * v0y;
        const d01 = v0x * v1x + v0y * v1y;
        const d11 = v1x * v1x + v1y * v1y;
        const d20 = v2x * v0x + v2y * v0y;
        const d21 = v2x * v1x + v2y * v1y;
        const denom = d00 * d11 - d01 * d01;
        if (Math.abs(denom) < 1e-12) continue;
        const inv = 1 / denom;
        const bv = (d11 * d20 - d01 * d21) * inv;
        const bw = (d00 * d21 - d01 * d20) * inv;
        const bu = 1 - bv - bw;
        if (bu < -epsilon || bv < -epsilon || bw < -epsilon) continue;
        hitTri = tri; w0 = bu; w1 = bv; w2 = bw;
        break;
      }
      const di = (y * size + x) * 4;
      if (!hitTri) {
        data[di] = data[di + 1] = data[di + 2] = 0; data[di + 3] = 255;
        continue;
      }
      covered++;
      worldP.set(
        hitTri.pA.x * w0 + hitTri.pB.x * w1 + hitTri.pC.x * w2,
        hitTri.pA.y * w0 + hitTri.pB.y * w1 + hitTri.pC.y * w2,
        hitTri.pA.z * w0 + hitTri.pB.z * w1 + hitTri.pC.z * w2,
      );
      const rx = Math.max(0, Math.min(1, (worldP.x - wbMin.x) * sX));
      const ry = Math.max(0, Math.min(1, (worldP.y - wbMin.y) * sY));
      const rz = Math.max(0, Math.min(1, (worldP.z - wbMin.z) * sZ));
      data[di]     = Math.round(rx * 255);
      data[di + 1] = Math.round(ry * 255);
      data[di + 2] = Math.round(rz * 255);
      data[di + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  mesh.userData = mesh.userData || {};
  mesh.userData.archdiscStudioPositionMap = {
    texture: tex,
    bbox: { min: [wbMin.x, wbMin.y, wbMin.z], size: [wbSize.x, wbSize.y, wbSize.z] },
    size,
    pixelsCovered: covered,
  };
  return {
    ok: true,
    size,
    pixelsCovered: covered,
    bboxMin: [wbMin.x, wbMin.y, wbMin.z],
    bboxSize: [wbSize.x, wbSize.y, wbSize.z],
  };
}
