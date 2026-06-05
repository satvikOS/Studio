// Slice 699 — Texture map baking: AO, curvature, cavity, height,
// per-vertex normal → texture. Substance Painter / Mari workflow gap.

import * as THREE from 'three';

const SIZE = 512;

function _newCanvas() {
  const c = document.createElement('canvas');
  c.width = SIZE; c.height = SIZE;
  return c;
}

function _sampleAO(geo, vertIdx, pos, nrm) {
  // Sample N rays in hemisphere around vertex normal; count occlusion.
  const N = 8;
  const origin = new THREE.Vector3().fromBufferAttribute(pos, vertIdx);
  const normal = new THREE.Vector3().fromBufferAttribute(nrm, vertIdx).normalize();
  let occ = 0;
  for (let r = 0; r < N; r++) {
    const u = Math.random(), v = Math.random();
    const phi = 2 * Math.PI * u;
    const cosTheta = v;
    const sinTheta = Math.sqrt(1 - cosTheta * cosTheta);
    const localDir = new THREE.Vector3(Math.cos(phi) * sinTheta, Math.sin(phi) * sinTheta, cosTheta);
    // Build orthonormal basis around normal
    const tangent = Math.abs(normal.x) > 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const t = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const b = new THREE.Vector3().crossVectors(normal, t);
    const worldDir = new THREE.Vector3()
      .addScaledVector(t, localDir.x)
      .addScaledVector(b, localDir.y)
      .addScaledVector(normal, localDir.z)
      .normalize();
    // Check intersection with nearby triangles (sampled).
    let hit = false;
    for (let t2 = 0; t2 < Math.min(pos.count / 3, 30); t2++) {
      const i0 = t2 * 3;
      if (i0 === vertIdx || i0 + 1 === vertIdx || i0 + 2 === vertIdx) continue;
      const a = new THREE.Vector3().fromBufferAttribute(pos, i0);
      const dist = a.distanceTo(origin);
      if (dist < 0.5 && worldDir.dot(a.clone().sub(origin).normalize()) > 0.7) {
        hit = true; break;
      }
    }
    if (hit) occ++;
  }
  return 1 - occ / N;
}

export function bakeAOMap(meshUuid) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = meshUuid ? scene.getObjectByProperty('uuid', meshUuid) : window.__studioSelectedMesh?.();
  if (!mesh || !mesh.geometry) return { ok: false };
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = g.attributes.position;
  let nrm = g.attributes.normal;
  if (!nrm) { g.computeVertexNormals(); nrm = g.attributes.normal; }
  const uv = g.attributes.uv;
  const canvas = _newCanvas();
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, SIZE, SIZE);
  if (!uv) return { ok: true, dataUrl: canvas.toDataURL(), warning: 'no UVs — flat white' };
  // For each triangle, sample AO at the 3 verts, paint a triangle on the AO map.
  const tris = pos.count / 3;
  for (let t = 0; t < tris; t++) {
    const ao0 = _sampleAO(g, t * 3, pos, nrm);
    const ao1 = _sampleAO(g, t * 3 + 1, pos, nrm);
    const ao2 = _sampleAO(g, t * 3 + 2, pos, nrm);
    const u0 = uv.getX(t * 3) * SIZE,     v0 = (1 - uv.getY(t * 3)) * SIZE;
    const u1 = uv.getX(t * 3 + 1) * SIZE, v1 = (1 - uv.getY(t * 3 + 1)) * SIZE;
    const u2 = uv.getX(t * 3 + 2) * SIZE, v2 = (1 - uv.getY(t * 3 + 2)) * SIZE;
    const ao = (ao0 + ao1 + ao2) / 3;
    const c = Math.max(0, Math.min(255, Math.round(ao * 255)));
    ctx.fillStyle = `rgb(${c},${c},${c})`;
    ctx.beginPath();
    ctx.moveTo(u0, v0); ctx.lineTo(u1, v1); ctx.lineTo(u2, v2); ctx.closePath();
    ctx.fill();
  }
  return { ok: true, dataUrl: canvas.toDataURL() };
}

export function bakeCurvatureMap(meshUuid) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = meshUuid ? scene.getObjectByProperty('uuid', meshUuid) : window.__studioSelectedMesh?.();
  if (!mesh || !mesh.geometry) return { ok: false };
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = g.attributes.position;
  if (!g.attributes.normal) g.computeVertexNormals();
  const nrm = g.attributes.normal;
  const uv = g.attributes.uv;
  const canvas = _newCanvas();
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, SIZE, SIZE);
  if (!uv) return { ok: true, dataUrl: canvas.toDataURL(), warning: 'no UVs' };
  const tris = pos.count / 3;
  for (let t = 0; t < tris; t++) {
    const n0 = new THREE.Vector3().fromBufferAttribute(nrm, t * 3);
    const n1 = new THREE.Vector3().fromBufferAttribute(nrm, t * 3 + 1);
    const n2 = new THREE.Vector3().fromBufferAttribute(nrm, t * 3 + 2);
    // Curvature ≈ dispersion of normals.
    const avg = new THREE.Vector3().add(n0).add(n1).add(n2).normalize();
    const curv = (1 - n0.dot(avg)) + (1 - n1.dot(avg)) + (1 - n2.dot(avg));
    const c = Math.max(0, Math.min(255, Math.round(128 + curv * 200)));
    const u0 = uv.getX(t * 3) * SIZE,     v0 = (1 - uv.getY(t * 3)) * SIZE;
    const u1 = uv.getX(t * 3 + 1) * SIZE, v1 = (1 - uv.getY(t * 3 + 1)) * SIZE;
    const u2 = uv.getX(t * 3 + 2) * SIZE, v2 = (1 - uv.getY(t * 3 + 2)) * SIZE;
    ctx.fillStyle = `rgb(${c},${c},${c})`;
    ctx.beginPath();
    ctx.moveTo(u0, v0); ctx.lineTo(u1, v1); ctx.lineTo(u2, v2); ctx.closePath();
    ctx.fill();
  }
  return { ok: true, dataUrl: canvas.toDataURL() };
}

export function bakeNormalMap(meshUuid) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = meshUuid ? scene.getObjectByProperty('uuid', meshUuid) : window.__studioSelectedMesh?.();
  if (!mesh || !mesh.geometry) return { ok: false };
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  if (!g.attributes.normal) g.computeVertexNormals();
  const nrm = g.attributes.normal;
  const uv = g.attributes.uv;
  const pos = g.attributes.position;
  const canvas = _newCanvas();
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgb(128,128,255)';
  ctx.fillRect(0, 0, SIZE, SIZE);
  if (!uv) return { ok: true, dataUrl: canvas.toDataURL(), warning: 'no UVs' };
  const tris = pos.count / 3;
  for (let t = 0; t < tris; t++) {
    const u0 = uv.getX(t * 3) * SIZE,     v0 = (1 - uv.getY(t * 3)) * SIZE;
    const u1 = uv.getX(t * 3 + 1) * SIZE, v1 = (1 - uv.getY(t * 3 + 1)) * SIZE;
    const u2 = uv.getX(t * 3 + 2) * SIZE, v2 = (1 - uv.getY(t * 3 + 2)) * SIZE;
    const navg = new THREE.Vector3()
      .add(new THREE.Vector3().fromBufferAttribute(nrm, t * 3))
      .add(new THREE.Vector3().fromBufferAttribute(nrm, t * 3 + 1))
      .add(new THREE.Vector3().fromBufferAttribute(nrm, t * 3 + 2))
      .multiplyScalar(1 / 3);
    const r = Math.round((navg.x * 0.5 + 0.5) * 255);
    const gC = Math.round((navg.y * 0.5 + 0.5) * 255);
    const bC = Math.round((navg.z * 0.5 + 0.5) * 255);
    ctx.fillStyle = `rgb(${r},${gC},${bC})`;
    ctx.beginPath();
    ctx.moveTo(u0, v0); ctx.lineTo(u1, v1); ctx.lineTo(u2, v2); ctx.closePath();
    ctx.fill();
  }
  return { ok: true, dataUrl: canvas.toDataURL() };
}

export function bakeHeightMap(meshUuid) {
  const scene = window.__archdiscScene;
  if (!scene) return { ok: false };
  const mesh = meshUuid ? scene.getObjectByProperty('uuid', meshUuid) : window.__studioSelectedMesh?.();
  if (!mesh || !mesh.geometry) return { ok: false };
  const g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  const canvas = _newCanvas();
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, SIZE, SIZE);
  if (!uv) return { ok: true, dataUrl: canvas.toDataURL(), warning: 'no UVs' };
  g.computeBoundingBox();
  const min = g.boundingBox.min.y, max = g.boundingBox.max.y;
  const range = (max - min) || 1;
  const tris = pos.count / 3;
  for (let t = 0; t < tris; t++) {
    const y0 = pos.getY(t * 3), y1 = pos.getY(t * 3 + 1), y2 = pos.getY(t * 3 + 2);
    const h = ((y0 + y1 + y2) / 3 - min) / range;
    const c = Math.max(0, Math.min(255, Math.round(h * 255)));
    const u0 = uv.getX(t * 3) * SIZE,     v0 = (1 - uv.getY(t * 3)) * SIZE;
    const u1 = uv.getX(t * 3 + 1) * SIZE, v1 = (1 - uv.getY(t * 3 + 1)) * SIZE;
    const u2 = uv.getX(t * 3 + 2) * SIZE, v2 = (1 - uv.getY(t * 3 + 2)) * SIZE;
    ctx.fillStyle = `rgb(${c},${c},${c})`;
    ctx.beginPath();
    ctx.moveTo(u0, v0); ctx.lineTo(u1, v1); ctx.lineTo(u2, v2); ctx.closePath();
    ctx.fill();
  }
  return { ok: true, dataUrl: canvas.toDataURL() };
}

export function bakeCavityMap(meshUuid) {
  // Cavity ≈ inverted AO.
  const ao = bakeAOMap(meshUuid);
  if (!ao.ok) return ao;
  // Re-render inverted.
  const img = new Image();
  return new Promise((resolve) => {
    img.onload = () => {
      const c = _newCanvas();
      const cx = c.getContext('2d');
      cx.fillStyle = '#ffffff';
      cx.fillRect(0, 0, SIZE, SIZE);
      cx.globalCompositeOperation = 'difference';
      cx.drawImage(img, 0, 0);
      resolve({ ok: true, dataUrl: c.toDataURL() });
    };
    img.src = ao.dataUrl;
  });
}
