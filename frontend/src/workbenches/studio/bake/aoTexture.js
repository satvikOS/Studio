import * as THREE from 'three';

/*
 * Substance Painter / Mari style bake-to-UV-texture AO. For every texel in
 * a `size`×`size` map, find the triangle that contains its UV, interpolate
 * world position + normal via barycentric coords, then cast a Lambert
 * hemisphere of rays and write the unoccluded fraction as greyscale to the
 * texture. The result is wired up as mesh.material.aoMap so the shader
 * darkens crevices in screen-space — the same workflow Substance ships.
 *
 * MVP scope: 256² default (or caller-supplied). Per-texel triangle search
 * uses UV-bbox prefilter + 2D barycentric coords. Single Three.js Raycaster
 * reused. Production-grade bakers (xNormal, Substance) keep a UV BVH and
 * dilate seams — both are deferred follow-ups.
 */
export function bakeAOToTexture(mesh, occluders, opts = {}) {
  const geo = mesh.geometry;
  if (!geo) return null;
  const uv = geo.attributes.uv;
  if (!uv) return { ok: false, error: 'mesh has no UV channel' };
  const pos = geo.attributes.position;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  if (!geo.boundingSphere) geo.computeBoundingSphere();

  const size = (opts.size | 0) || 256;
  // Small bakes default to a sparser hemisphere so e2e stays under 10s.
  const rays = (opts.rays | 0) || (size <= 64 ? 8 : 16);
  const epsilon = 1e-5;
  const maxDist = opts.maxDist || (geo.boundingSphere.radius * 1.6);

  mesh.updateMatrixWorld(true);
  occluders.forEach((o) => { if (o.updateMatrixWorld) o.updateMatrixWorld(true); });
  const nMat = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);

  // Build triangles[] with UV bbox + world positions/normals per vertex.
  const triangles = [];
  const addTri = (a, b, c) => {
    const uAx = uv.getX(a), uAy = uv.getY(a);
    const uBx = uv.getX(b), uBy = uv.getY(b);
    const uCx = uv.getX(c), uCy = uv.getY(c);
    const pA = new THREE.Vector3(pos.getX(a), pos.getY(a), pos.getZ(a)).applyMatrix4(mesh.matrixWorld);
    const pB = new THREE.Vector3(pos.getX(b), pos.getY(b), pos.getZ(b)).applyMatrix4(mesh.matrixWorld);
    const pC = new THREE.Vector3(pos.getX(c), pos.getY(c), pos.getZ(c)).applyMatrix4(mesh.matrixWorld);
    const nA = new THREE.Vector3(nrm.getX(a), nrm.getY(a), nrm.getZ(a)).applyMatrix3(nMat).normalize();
    const nB = new THREE.Vector3(nrm.getX(b), nrm.getY(b), nrm.getZ(b)).applyMatrix3(nMat).normalize();
    const nC = new THREE.Vector3(nrm.getX(c), nrm.getY(c), nrm.getZ(c)).applyMatrix3(nMat).normalize();
    triangles.push({
      uAx, uAy, uBx, uBy, uCx, uCy,
      uMin: Math.min(uAx, uBx, uCx), uMax: Math.max(uAx, uBx, uCx),
      vMin: Math.min(uAy, uBy, uCy), vMax: Math.max(uAy, uBy, uCy),
      pA, pB, pC, nA, nB, nC,
    });
  };
  if (geo.index) {
    const idx = geo.index.array;
    for (let i = 0; i < idx.length; i += 3) addTri(idx[i], idx[i + 1], idx[i + 2]);
  } else {
    for (let i = 0; i < pos.count; i += 3) addTri(i, i + 1, i + 2);
  }

  // Golden-angle Fibonacci hemisphere directions (mirrors ambientOcclusion.js).
  const base = [];
  for (let i = 0; i < rays; i++) {
    const y = (i + 0.5) / rays;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const phi = i * 2.399963229728653;
    base.push(new THREE.Vector3(Math.cos(phi) * r, y, Math.sin(phi) * r));
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  const data = img.data;

  const rc = new THREE.Raycaster(); rc.far = maxDist;
  const origin = new THREE.Vector3(), worldP = new THREE.Vector3(), worldN = new THREE.Vector3();
  const tangent = new THREE.Vector3(), bitangent = new THREE.Vector3(), up = new THREE.Vector3();
  const dir = new THREE.Vector3();

  let covered = 0, mn = 1, mx = 0, sum = 0;
  for (let y = 0; y < size; y++) {
    const v = 1 - (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      let hitTri = null, w0 = 0, w1 = 0, w2 = 0;
      for (const tri of triangles) {
        if (u < tri.uMin || u > tri.uMax || v < tri.vMin || v > tri.vMax) continue;
        // 2D barycentric of (u,v) inside (uAx,uAy)(uBx,uBy)(uCx,uCy).
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
        data[di] = data[di + 1] = data[di + 2] = 255; data[di + 3] = 255;
        continue;
      }
      covered++;
      worldP.set(
        hitTri.pA.x * w0 + hitTri.pB.x * w1 + hitTri.pC.x * w2,
        hitTri.pA.y * w0 + hitTri.pB.y * w1 + hitTri.pC.y * w2,
        hitTri.pA.z * w0 + hitTri.pB.z * w1 + hitTri.pC.z * w2,
      );
      worldN.set(
        hitTri.nA.x * w0 + hitTri.nB.x * w1 + hitTri.nC.x * w2,
        hitTri.nA.y * w0 + hitTri.nB.y * w1 + hitTri.nC.y * w2,
        hitTri.nA.z * w0 + hitTri.nB.z * w1 + hitTri.nC.z * w2,
      ).normalize();
      up.set(0, 1, 0); if (Math.abs(worldN.y) > 0.99) up.set(1, 0, 0);
      tangent.crossVectors(up, worldN).normalize();
      bitangent.crossVectors(worldN, tangent);
      origin.copy(worldP).addScaledVector(worldN, maxDist * 0.01);

      let occ = 0;
      for (const b of base) {
        dir.set(0, 0, 0)
          .addScaledVector(tangent, b.x)
          .addScaledVector(worldN, b.y)
          .addScaledVector(bitangent, b.z)
          .normalize();
        rc.set(origin, dir); rc.far = maxDist;
        const hits = rc.intersectObjects(occluders, false);
        for (const h of hits) { if (h.distance > maxDist * 0.02) { occ++; break; } }
      }
      const ao = 1 - occ / base.length;
      const g = Math.round(ao * 255);
      data[di] = data[di + 1] = data[di + 2] = g; data[di + 3] = 255;
      if (ao < mn) mn = ao; if (ao > mx) mx = ao; sum += ao;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  // Three.js MeshStandardMaterial needs uv1 for aoMap.
  if (!geo.attributes.uv1) geo.setAttribute('uv1', geo.attributes.uv);
  if (mesh.material) {
    mesh.material.aoMap = tex;
    mesh.material.aoMapIntensity = 1;
    mesh.material.needsUpdate = true;
  }
  const meanCovered = covered > 0 ? sum / covered : 1;
  return { ok: true, size, rays: base.length, pixelsCovered: covered, mean: meanCovered, min: mn, max: mx };
}
