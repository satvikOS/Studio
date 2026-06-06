import * as THREE from 'three';

/*
 * Substance Painter / Mari / Marmoset Toolbag style bake-to-UV-texture
 * for an OBJECT-SPACE normal map.
 *
 * Mirrors bake/aoTexture.js's per-texel UV-grid + UV-bbox prefilter +
 * 2D barycentric triangle resolution. For each texel:
 *   1. find the UV-containing triangle;
 *   2. barycentric-interpolate the world-space surface normal;
 *   3. encode `n * 0.5 + 0.5` to RGB and write the 8-bit colour.
 *
 * Why object-space (not tangent-space): a SELF-bake (high-poly to itself)
 * would write the identity (0,0,1) at every texel under tangent-space,
 * which is useless. Object-space records the actual world direction of
 * the surface normal — usable in shaders, smart materials, and AO
 * verification. Substance, Marmoset, and xNormal all expose this mode.
 * For detail transfer from a higher-density source mesh to a low-poly
 * target, add a `sourceMesh` opt in a follow-up (tangent-space transfer).
 *
 * Empty texels (UV-island gaps) get flat-up `(0.5, 0.5, 1.0)`.
 *
 * Result is wired as `mesh.material.normalMap` so MeshStandardMaterial
 * picks it up. Returns `{ ok, size, pixelsCovered }`.
 */
export function bakeNormalToTexture(mesh, opts = {}) {
  const geo = mesh.geometry;
  if (!geo) return { ok: false, error: 'no geometry' };
  const uv = geo.attributes.uv;
  if (!uv) return { ok: false, error: 'mesh has no UV channel' };
  const pos = geo.attributes.position;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nrm = geo.attributes.normal;

  const size = (opts.size | 0) || 256;
  const epsilon = 1e-5;

  mesh.updateMatrixWorld(true);
  const nMat = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);

  // Build triangles[] with UV bbox + world-space normals per vertex.
  const triangles = [];
  const addTri = (a, b, c) => {
    const uAx = uv.getX(a), uAy = uv.getY(a);
    const uBx = uv.getX(b), uBy = uv.getY(b);
    const uCx = uv.getX(c), uCy = uv.getY(c);
    const nA = new THREE.Vector3(nrm.getX(a), nrm.getY(a), nrm.getZ(a)).applyMatrix3(nMat).normalize();
    const nB = new THREE.Vector3(nrm.getX(b), nrm.getY(b), nrm.getZ(b)).applyMatrix3(nMat).normalize();
    const nC = new THREE.Vector3(nrm.getX(c), nrm.getY(c), nrm.getZ(c)).applyMatrix3(nMat).normalize();
    triangles.push({
      uAx, uAy, uBx, uBy, uCx, uCy,
      uMin: Math.min(uAx, uBx, uCx), uMax: Math.max(uAx, uBx, uCx),
      vMin: Math.min(uAy, uBy, uCy), vMax: Math.max(uAy, uBy, uCy),
      nA, nB, nC,
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

  const worldN = new THREE.Vector3();

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
        // Neutral up — Substance's "no normal here" convention.
        data[di] = 128; data[di + 1] = 128; data[di + 2] = 255; data[di + 3] = 255;
        continue;
      }
      covered++;
      worldN.set(
        hitTri.nA.x * w0 + hitTri.nB.x * w1 + hitTri.nC.x * w2,
        hitTri.nA.y * w0 + hitTri.nB.y * w1 + hitTri.nC.y * w2,
        hitTri.nA.z * w0 + hitTri.nB.z * w1 + hitTri.nC.z * w2,
      ).normalize();
      // Object-space encode: each axis from [-1,1] → [0,255].
      // Top face (+Y) → (128, 255, 128); +X face → (255, 128, 128);
      // +Z face → (128, 128, 255); -Z face → (128, 128, 0).
      data[di]     = Math.max(0, Math.min(255, Math.round((worldN.x * 0.5 + 0.5) * 255)));
      data[di + 1] = Math.max(0, Math.min(255, Math.round((worldN.y * 0.5 + 0.5) * 255)));
      data[di + 2] = Math.max(0, Math.min(255, Math.round((worldN.z * 0.5 + 0.5) * 255)));
      data[di + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  if (mesh.material) {
    mesh.material.normalMap = tex;
    mesh.material.needsUpdate = true;
  }
  // Stamp on userData for introspection / e2e.
  mesh.userData = mesh.userData || {};
  mesh.userData.archdiscStudioNormalMap = { size, pixelsCovered: covered };
  return { ok: true, size, pixelsCovered: covered };
}
