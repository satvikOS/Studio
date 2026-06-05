// Slice 698 — Proxy cube mesh with the raymarch shader material.

import * as THREE from 'three';
import { VOLUME_VERTEX, VOLUME_FRAGMENT } from './shader.frag.js';
import { getVolume } from './grid.js';

const _meshByUuid = new Map();

export function buildProxyMesh(volumeUuid, params) {
  const v = getVolume(volumeUuid);
  if (!v) return { ok: false };
  const size = [v.sx * v.voxelSize, v.sy * v.voxelSize, v.sz * v.voxelSize];
  const mn = new THREE.Vector3(-size[0] / 2, -size[1] / 2, -size[2] / 2);
  const mx = new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2);

  const camera = window.__archdiscViewport?.camera || new THREE.PerspectiveCamera();
  const mat = new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: VOLUME_VERTEX,
    fragmentShader: VOLUME_FRAGMENT,
    uniforms: {
      uVolume: { value: v.tex },
      uBoundsMin: { value: mn },
      uBoundsMax: { value: mx },
      uCameraPos: { value: camera.position },
      uDensityScale: { value: params?.densityScale ?? 1.0 },
      uTempScale: { value: params?.tempScale ?? 1.0 },
      uSteps: { value: params?.steps ?? 64 },
      uLightDir: { value: new THREE.Vector3(...(params?.lightDir || [0.4, 0.7, 0.5])).normalize() },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
  });
  const geo = new THREE.BoxGeometry(size[0], size[1], size[2]);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.userData.archdiscStudioPrimitive = true;
  mesh.userData.archdiscStudioPrimitiveKind = 'volume';
  mesh.name = 'volume';
  mesh.onBeforeRender = () => {
    if (window.__archdiscViewport?.camera) {
      mat.uniforms.uCameraPos.value.copy(window.__archdiscViewport.camera.position);
    }
  };
  v.mesh = mesh;
  _meshByUuid.set(volumeUuid, mesh);
  if (window.__archdiscScene) window.__archdiscScene.add(mesh);
  return { ok: true, uuid: mesh.uuid };
}

export function updateProxyParams(volumeUuid, params) {
  const v = getVolume(volumeUuid);
  if (!v || !v.mesh) return { ok: false };
  const u = v.mesh.material.uniforms;
  if (params?.densityScale != null) u.uDensityScale.value = Number(params.densityScale);
  if (params?.tempScale != null) u.uTempScale.value = Number(params.tempScale);
  if (params?.steps != null) u.uSteps.value = Math.max(8, Math.min(256, Math.floor(params.steps)));
  if (Array.isArray(params?.lightDir)) u.uLightDir.value.set(params.lightDir[0], params.lightDir[1], params.lightDir[2]).normalize();
  return { ok: true };
}

export function getProxyMesh(volumeUuid) { return _meshByUuid.get(volumeUuid); }
