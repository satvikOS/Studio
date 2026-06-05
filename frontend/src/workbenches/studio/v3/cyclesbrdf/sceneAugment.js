// Slice 697 — Augments the rtgpu scene with 2 Float32 DataTextures
// holding per-tri (roughness, metalness, transmission, ior) and
// (emissive.r, emissive.g, emissive.b, emissiveIntensity). Stored on
// window.__archdiscViewport.__studioRTGPUBRDF for downstream consumers
// (or future GLSL bindings) to consult per ray hit.

import * as THREE from 'three';
import { packExtendedMaterial } from './packer.js';

const MAX_TRIS = 4096; // matches rtgpu/sceneToTextures.js cap

function _isTraceable(o) {
  if (!o || !o.isMesh) return false;
  const ud = o.userData || {};
  if (ud.archdiscStudioGizmo || ud.archdiscStudioGrid || ud.archdiscStudioGround) return false;
  if (ud.archdiscStudioCameraHelper || ud.archdiscStudioIKHandle) return false;
  if (ud.isHelper || ud.archdiscStudioHelper) return false;
  if (o.material && o.material.wireframe) return false;
  return true;
}

function _makeFloat32Tex(width) {
  const data = new Float32Array(width * 4);
  const tex = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat, THREE.FloatType);
  tex.needsUpdate = true;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  return tex;
}

export function augmentSceneTextures() {
  const vp = window.__archdiscViewport;
  if (!vp || !vp.scene) return { ok: false, error: 'no scene' };

  // Pre-count tris so the buffer width matches rtgpu's layout.
  let triCount = 0;
  vp.scene.traverse((o) => {
    if (!_isTraceable(o) || !o.geometry || !o.geometry.attributes.position) return;
    const idx = o.geometry.index;
    triCount += idx ? (idx.count / 3) : (o.geometry.attributes.position.count / 3);
  });
  const width = Math.max(1, Math.min(MAX_TRIS, Math.floor(triCount)));

  let prev = vp.__studioRTGPUBRDF;
  if (!prev || prev.matTex.image.width !== width) {
    if (prev) { prev.matTex.dispose && prev.matTex.dispose(); prev.emTex.dispose && prev.emTex.dispose(); }
    prev = vp.__studioRTGPUBRDF = { matTex: _makeFloat32Tex(width), emTex: _makeFloat32Tex(width), count: width };
  }
  const matArr = prev.matTex.image.data;
  const emArr = prev.emTex.image.data;

  let w = 0;
  vp.scene.traverse((o) => {
    if (w >= width) return;
    if (!_isTraceable(o) || !o.geometry || !o.geometry.attributes.position) return;
    const pack = packExtendedMaterial(o);
    if (!pack) return;
    const idx = o.geometry.index;
    const triN = idx ? (idx.count / 3) : (o.geometry.attributes.position.count / 3);
    for (let t = 0; t < triN && w < width; t++, w++) {
      matArr[w * 4]     = pack.roughness;
      matArr[w * 4 + 1] = pack.metalness;
      matArr[w * 4 + 2] = pack.transmission;
      matArr[w * 4 + 3] = pack.ior;
      emArr[w * 4]      = pack.emissive[0];
      emArr[w * 4 + 1]  = pack.emissive[1];
      emArr[w * 4 + 2]  = pack.emissive[2];
      emArr[w * 4 + 3]  = pack.emissiveIntensity;
    }
  });
  prev.matTex.needsUpdate = true;
  prev.emTex.needsUpdate = true;
  prev.lastBuiltAt = performance.now();
  return { ok: true, count: w };
}
