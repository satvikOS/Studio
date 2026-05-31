import * as THREE from 'three';

/*
 * Mari project-paint from the current camera view. For every texel of a
 * UV-mapped destination texture: walk its containing triangle, interpolate
 * the world position, project that position through the camera, sample the
 * source image at the resulting NDC, write to the destination canvas.
 *
 * MVP scope: no depth-occlusion test (single-mesh scene assumption). A
 * followup slice will sample a scene-depth render target so back-facing
 * texels are skipped.
 */
export function projectPaintFromCamera(mesh, camera, sourceImageData, opts = {}) {
  if (!mesh || !mesh.geometry || !mesh.material) return { ok: false, error: 'no mesh/material' };
  if (!camera) return { ok: false, error: 'no camera' };
  const geo = mesh.geometry;
  const uv = geo.attributes.uv;
  if (!uv) return { ok: false, error: 'mesh has no UV channel' };
  const pos = geo.attributes.position;
  const size = (opts.size | 0) || 256;
  const srcW = sourceImageData.width, srcH = sourceImageData.height;
  const srcData = sourceImageData.data;

  mesh.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();

  // Build triangles with UV bboxes + world positions per vertex.
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
  let projected = 0, behindCamera = 0, outOfFrustum = 0;
  const epsilon = 1e-5;

  for (let y = 0; y < size; y++) {
    const v = 1 - (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      let hit = null, w0 = 0, w1 = 0, w2 = 0;
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
        hit = tri; w0 = bu; w1 = bv; w2 = bw;
        break;
      }
      const di = (y * size + x) * 4;
      if (!hit) { data[di] = data[di + 1] = data[di + 2] = 0; data[di + 3] = 0; continue; }
      worldP.set(
        hit.pA.x * w0 + hit.pB.x * w1 + hit.pC.x * w2,
        hit.pA.y * w0 + hit.pB.y * w1 + hit.pC.y * w2,
        hit.pA.z * w0 + hit.pB.z * w1 + hit.pC.z * w2,
      );
      const ndc = worldP.clone().project(camera);
      if (ndc.z < -1 || ndc.z > 1) { behindCamera++; continue; }
      if (ndc.x < -1 || ndc.x > 1 || ndc.y < -1 || ndc.y > 1) { outOfFrustum++; continue; }
      const sx = Math.floor((ndc.x * 0.5 + 0.5) * srcW);
      const sy = Math.floor((1 - (ndc.y * 0.5 + 0.5)) * srcH);
      const sxc = Math.max(0, Math.min(srcW - 1, sx));
      const syc = Math.max(0, Math.min(srcH - 1, sy));
      const si = (syc * srcW + sxc) * 4;
      data[di]     = srcData[si];
      data[di + 1] = srcData[si + 1];
      data[di + 2] = srcData[si + 2];
      data[di + 3] = 255;
      projected++;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  const prev = mesh.material.map;
  if (prev && prev.dispose) prev.dispose();
  mesh.material.map = tex;
  mesh.material.needsUpdate = true;
  return { ok: true, size, projected, outOfFrustum, behindCamera, skipped: 'depth-occlusion' };
}
