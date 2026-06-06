// Slice 708 — Substance Painter texture-set baker. For each texture
// "set" (one material slot), bake the high-poly mesh's properties
// (normal / curvature / AO / position / thickness / world-space
// normal) into UV-space textures of the low-poly. Mirrors Substance
// Painter's bake pipeline.

import * as THREE from 'three';

function _fill(buf, w, h, val) {
  for (let i = 0; i < w * h * 4; i++) buf[i] = val;
}

function _raycastNormal(scene, fromPos, dir, raycaster) {
  raycaster.set(fromPos, dir);
  raycaster.far = 10;
  const meshes = [];
  scene.traverseVisible((o) => { if (o.isMesh) meshes.push(o); });
  const hits = raycaster.intersectObjects(meshes, false);
  return hits.length > 0 ? hits[0] : null;
}

// Bake the high-poly's normal into the low-poly's UV space by
// shooting a ray from each low-poly UV-tessellated triangle's center
// along the low-poly's normal back into the high-poly.
export function bakeNormalFromHigh(lowUuid, highUuid, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const low = scene.getObjectByProperty('uuid', lowUuid);
  const high = scene.getObjectByProperty('uuid', highUuid);
  if (!low || !high || !low.geometry?.attributes?.uv) return { ok: false };
  const W = Math.max(32, Math.min(2048, Number(opts?.size) || 512));
  const H = W;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  _fill(img.data, W, H, 0);
  const idx = low.geometry.index ? low.geometry.index.array : null;
  const lpos = low.geometry.attributes.position.array;
  const luv = low.geometry.attributes.uv.array;
  const lnormal = low.geometry.attributes.normal.array;
  const triCount = idx ? idx.length / 3 : lpos.length / 9;
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3] : t * 3;
    const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const uA = [luv[i0 * 2], luv[i0 * 2 + 1]];
    const uB = [luv[i1 * 2], luv[i1 * 2 + 1]];
    const uC = [luv[i2 * 2], luv[i2 * 2 + 1]];
    const minX = Math.max(0, Math.floor(Math.min(uA[0], uB[0], uC[0]) * W));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(uA[0], uB[0], uC[0]) * W));
    const minY = Math.max(0, Math.floor(Math.min(uA[1], uB[1], uC[1]) * H));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(uA[1], uB[1], uC[1]) * H));
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const u = (px + 0.5) / W;
        const v = (py + 0.5) / H;
        // Barycentric.
        const d00 = (uB[0] - uA[0]) * (uB[0] - uA[0]) + (uB[1] - uA[1]) * (uB[1] - uA[1]);
        const d01 = (uB[0] - uA[0]) * (uC[0] - uA[0]) + (uB[1] - uA[1]) * (uC[1] - uA[1]);
        const d11 = (uC[0] - uA[0]) * (uC[0] - uA[0]) + (uC[1] - uA[1]) * (uC[1] - uA[1]);
        const d20 = (u - uA[0]) * (uB[0] - uA[0]) + (v - uA[1]) * (uB[1] - uA[1]);
        const d21 = (u - uA[0]) * (uC[0] - uA[0]) + (v - uA[1]) * (uC[1] - uA[1]);
        const denom = d00 * d11 - d01 * d01;
        if (Math.abs(denom) < 1e-12) continue;
        const wB = (d11 * d20 - d01 * d21) / denom;
        const wC = (d00 * d21 - d01 * d20) / denom;
        const wA = 1 - wB - wC;
        if (wA < 0 || wB < 0 || wC < 0) continue;
        const wx = lpos[i0 * 3] * wA + lpos[i1 * 3] * wB + lpos[i2 * 3] * wC;
        const wy = lpos[i0 * 3 + 1] * wA + lpos[i1 * 3 + 1] * wB + lpos[i2 * 3 + 1] * wC;
        const wz = lpos[i0 * 3 + 2] * wA + lpos[i1 * 3 + 2] * wB + lpos[i2 * 3 + 2] * wC;
        const nx = lnormal[i0 * 3] * wA + lnormal[i1 * 3] * wB + lnormal[i2 * 3] * wC;
        const ny = lnormal[i0 * 3 + 1] * wA + lnormal[i1 * 3 + 1] * wB + lnormal[i2 * 3 + 1] * wC;
        const nz = lnormal[i0 * 3 + 2] * wA + lnormal[i1 * 3 + 2] * wB + lnormal[i2 * 3 + 2] * wC;
        const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        // Shoot in both directions; favor closer.
        const origin = new THREE.Vector3(wx + nx / nLen * 0.5, wy + ny / nLen * 0.5, wz + nz / nLen * 0.5);
        const dir = new THREE.Vector3(-nx / nLen, -ny / nLen, -nz / nLen);
        const hit = _raycastNormal(scene, origin, dir, raycaster);
        if (hit && hit.face) {
          const fn = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
          // Encode normal into RGB [0..1].
          const dst = (py * W + px) * 4;
          img.data[dst] = Math.round((fn.x * 0.5 + 0.5) * 255);
          img.data[dst + 1] = Math.round((fn.y * 0.5 + 0.5) * 255);
          img.data[dst + 2] = Math.round((fn.z * 0.5 + 0.5) * 255);
          img.data[dst + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return { ok: true, canvas: cv, dataURL: cv.toDataURL('image/png') };
}

// Position bake (XYZ in 0..1 world-space).
export function bakePosition(meshUuid, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh || !mesh.geometry?.attributes?.uv) return { ok: false };
  const W = Math.max(32, Math.min(2048, Number(opts?.size) || 512));
  const H = W;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const idx = mesh.geometry.index ? mesh.geometry.index.array : null;
  const pos = mesh.geometry.attributes.position.array;
  const uv = mesh.geometry.attributes.uv.array;
  const box = new THREE.Box3().setFromObject(mesh);
  const sz = new THREE.Vector3(); box.getSize(sz);
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3] : t * 3;
    const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const uA = [uv[i0 * 2], uv[i0 * 2 + 1]];
    const uB = [uv[i1 * 2], uv[i1 * 2 + 1]];
    const uC = [uv[i2 * 2], uv[i2 * 2 + 1]];
    const minX = Math.max(0, Math.floor(Math.min(uA[0], uB[0], uC[0]) * W));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(uA[0], uB[0], uC[0]) * W));
    const minY = Math.max(0, Math.floor(Math.min(uA[1], uB[1], uC[1]) * H));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(uA[1], uB[1], uC[1]) * H));
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const u = (px + 0.5) / W;
        const v = (py + 0.5) / H;
        const d00 = (uB[0] - uA[0]) * (uB[0] - uA[0]) + (uB[1] - uA[1]) * (uB[1] - uA[1]);
        const d01 = (uB[0] - uA[0]) * (uC[0] - uA[0]) + (uB[1] - uA[1]) * (uC[1] - uA[1]);
        const d11 = (uC[0] - uA[0]) * (uC[0] - uA[0]) + (uC[1] - uA[1]) * (uC[1] - uA[1]);
        const d20 = (u - uA[0]) * (uB[0] - uA[0]) + (v - uA[1]) * (uB[1] - uA[1]);
        const d21 = (u - uA[0]) * (uC[0] - uA[0]) + (v - uA[1]) * (uC[1] - uA[1]);
        const denom = d00 * d11 - d01 * d01;
        if (Math.abs(denom) < 1e-12) continue;
        const wB = (d11 * d20 - d01 * d21) / denom;
        const wC = (d00 * d21 - d01 * d20) / denom;
        const wA = 1 - wB - wC;
        if (wA < 0 || wB < 0 || wC < 0) continue;
        const wx = pos[i0 * 3] * wA + pos[i1 * 3] * wB + pos[i2 * 3] * wC;
        const wy = pos[i0 * 3 + 1] * wA + pos[i1 * 3 + 1] * wB + pos[i2 * 3 + 1] * wC;
        const wz = pos[i0 * 3 + 2] * wA + pos[i1 * 3 + 2] * wB + pos[i2 * 3 + 2] * wC;
        const r = sz.x === 0 ? 0 : (wx - box.min.x) / sz.x;
        const g = sz.y === 0 ? 0 : (wy - box.min.y) / sz.y;
        const b = sz.z === 0 ? 0 : (wz - box.min.z) / sz.z;
        const dst = (py * W + px) * 4;
        img.data[dst] = Math.round(r * 255);
        img.data[dst + 1] = Math.round(g * 255);
        img.data[dst + 2] = Math.round(b * 255);
        img.data[dst + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return { ok: true, canvas: cv, dataURL: cv.toDataURL('image/png') };
}

// Thickness bake (ray from inside the surface in the opposite normal
// direction; distance to hit clamped to 1).
export function bakeThickness(meshUuid, opts) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = scene.getObjectByProperty('uuid', meshUuid);
  if (!mesh) return { ok: false };
  const W = Math.max(32, Math.min(2048, Number(opts?.size) || 256));
  const H = W;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const idx = mesh.geometry.index ? mesh.geometry.index.array : null;
  const pos = mesh.geometry.attributes.position.array;
  const uv = mesh.geometry.attributes.uv.array;
  const nrm = mesh.geometry.attributes.normal.array;
  const raycaster = new THREE.Raycaster();
  raycaster.firstHitOnly = true;
  const meshes = [mesh];
  const triCount = idx ? idx.length / 3 : pos.length / 9;
  for (let t = 0; t < triCount; t++) {
    const i0 = idx ? idx[t * 3] : t * 3;
    const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
    const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const uA = [uv[i0 * 2], uv[i0 * 2 + 1]];
    const uB = [uv[i1 * 2], uv[i1 * 2 + 1]];
    const uC = [uv[i2 * 2], uv[i2 * 2 + 1]];
    const cx = ((uA[0] + uB[0] + uC[0]) / 3) * W | 0;
    const cy = ((uA[1] + uB[1] + uC[1]) / 3) * H | 0;
    if (cx < 0 || cx >= W || cy < 0 || cy >= H) continue;
    const wx = (pos[i0 * 3] + pos[i1 * 3] + pos[i2 * 3]) / 3;
    const wy = (pos[i0 * 3 + 1] + pos[i1 * 3 + 1] + pos[i2 * 3 + 1]) / 3;
    const wz = (pos[i0 * 3 + 2] + pos[i1 * 3 + 2] + pos[i2 * 3 + 2]) / 3;
    const nx = (nrm[i0 * 3] + nrm[i1 * 3] + nrm[i2 * 3]) / 3;
    const ny = (nrm[i0 * 3 + 1] + nrm[i1 * 3 + 1] + nrm[i2 * 3 + 1]) / 3;
    const nz = (nrm[i0 * 3 + 2] + nrm[i1 * 3 + 2] + nrm[i2 * 3 + 2]) / 3;
    const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    const origin = new THREE.Vector3(wx - nx / nLen * 0.01, wy - ny / nLen * 0.01, wz - nz / nLen * 0.01);
    const dir = new THREE.Vector3(-nx / nLen, -ny / nLen, -nz / nLen);
    raycaster.set(origin, dir);
    const hits = raycaster.intersectObjects(meshes, false);
    let thick = 0;
    if (hits.length > 0) thick = Math.min(1, hits[0].distance);
    const dst = (cy * W + cx) * 4;
    img.data[dst] = Math.round(thick * 255);
    img.data[dst + 1] = Math.round(thick * 255);
    img.data[dst + 2] = Math.round(thick * 255);
    img.data[dst + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return { ok: true, canvas: cv, dataURL: cv.toDataURL('image/png') };
}
